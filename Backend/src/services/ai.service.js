const OpenAI = require("openai");
const { z } = require("zod");
const path = require("path");
const puppeteer = require("puppeteer")

require("../config/env"); // loads Backend/.env (once)

/**
 * The OpenAI SDK is used with NVIDIA's OpenAI-compatible API (key: NVIDIA_API_KEY).
 * The client is created lazily on first use: creating it at module load crashes the
 * whole server when the key is missing, even though only the AI features need it.
 */
const AI_NOT_CONFIGURED = "AI_NOT_CONFIGURED";
let client = null;

function getClient() {
    if (!process.env.NVIDIA_API_KEY) {
        const error = new Error("NVIDIA_API_KEY is missing from Backend/.env — AI features are unavailable.");
        error.code = AI_NOT_CONFIGURED;
        throw error;
    }
    if (!client) {
        client = new OpenAI({
            apiKey: process.env.NVIDIA_API_KEY,
            baseURL: "https://integrate.api.nvidia.com/v1",
            timeout: 180000, // 180 seconds (20 questions + skill analysis is a long response)
            maxRetries: 2
        });
    }
    return client;
}

const MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const TECHNICAL_QUESTION_COUNT = 10;
const BEHAVIORAL_QUESTION_COUNT = 10;


/* ──────────────────────────────────────────────────────────────────────────
 * Interview report
 * ────────────────────────────────────────────────────────────────────────── */

const questionSchema = z.object({
    question: z.string().min(1),
    intention: z.string().min(1),
    answer: z.string().min(1)
});

// Accepts a list, or a single string the model sometimes returns instead
// ("JOINs (INNER, LEFT); GROUP BY" → ["JOINs (INNER, LEFT)", "GROUP BY"]). Commas inside () are kept.
const stringList = z.preprocess(
    (value) => {
        if (value === null || value === undefined) return [];
        if (typeof value === "string") {
            return value.split(/\n|;|•|,(?![^(]*\))/).map(s => s.replace(/^\s*[-*\d.)]+\s*/, "").trim()).filter(Boolean);
        }
        return value;
    },
    z.array(z.string())
);

/**
 * One requirement extracted from the job description and judged against the candidate profile.
 * The AI only classifies; the match score is computed from these classifications in code.
 */
const skillAnalysisSchema = z.object({
    skill: z.string().min(1),
    importance: z.enum([ "required", "preferred", "nice-to-have" ]),
    status: z.enum([ "matched", "partial", "missing" ]),
    evidence: z.string().default(""),
    whyItMatters: z.string().default(""),
    topics: stringList,
    focusAreas: stringList
}).refine(
    s => s.status === "matched" || (s.whyItMatters.trim().length > 0 && s.topics.length >= 2),
    { message: "Every partial/missing skill needs whyItMatters and at least 2 topics" }
);

const interviewReportSchema = z.object({
    title: z.string().min(1),
    experienceMatch: z.enum([ "meets", "partial", "below" ]),
    experienceNote: z.string().default(""),
    skillAnalysis: z.array(skillAnalysisSchema).min(3),
    // The model sometimes miscounts (e.g. 9 instead of 10). Accept a reasonable batch here;
    // ensureQuestionCount() then tops up / trims to exactly the required number.
    technicalQuestions: z.array(questionSchema).min(5),
    behavioralQuestions: z.array(questionSchema).min(5)
});

const normalizeQuestion = (q) => q.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function dedupeQuestions(questions) {
    const seen = new Set();
    return questions.filter(q => {
        const key = normalizeQuestion(q);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Guarantees exactly `target` questions of one type.
 * Extra questions are trimmed; missing ones are requested in a small follow-up call
 * that sees the existing questions so it doesn't repeat them.
 */
async function ensureQuestionCount({ questions, type, target, resume, selfDescription, jobDescription }) {
    let result = dedupeQuestions(questions);

    for (let attempt = 1; result.length < target && attempt <= 3; attempt++) {
        const missing = target - result.length;
        console.log(`Topping up ${type} questions: need ${missing} more (attempt ${attempt}/3)...`);

        const response = await getClient().chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: "You are an expert interview coach. Return a valid JSON object only."
                },
                {
                    role: "user",
                    content: `Write ${missing + 1} NEW ${type} interview questions for this candidate and job.

RESUME:
${resume || "(not provided)"}

CANDIDATE SELF-DESCRIPTION:
${selfDescription || "(not provided)"}

JOB DESCRIPTION:
${jobDescription}

Questions already written (do NOT repeat or rephrase these):
${result.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}

Each item has "question", "intention" (what is being evaluated) and "answer" (a strong model answer, 60–120 words,
based on the candidate's real background; never invent experience).
Return: { "questions": [ { "question": "", "intention": "", "answer": "" } ] }`
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
            max_tokens: 4000,
            chat_template_kwargs: { enable_thinking: false }
        });

        try {
            const parsed = JSON.parse(response.choices?.[0]?.message?.content || "{}");
            const extra = (Array.isArray(parsed.questions) ? parsed.questions : [])
                .map(q => questionSchema.safeParse(q))
                .filter(r => r.success)
                .map(r => r.data);
            result = dedupeQuestions([ ...result, ...extra ]);
        } catch {
            console.error(`Top-up for ${type} questions returned invalid JSON.`);
        }
    }

    if (result.length < target) {
        throw new Error(`Could only generate ${result.length} of ${target} ${type} questions.`);
    }

    return result.slice(0, target);
}

// Scoring weights (deterministic — same analysis always gives the same score)
const IMPORTANCE_WEIGHT = { "required": 3, "preferred": 2, "nice-to-have": 1 };
const STATUS_CREDIT = { matched: 1, partial: 0.5, missing: 0 };
const EXPERIENCE_CREDIT = { meets: 1, partial: 0.5, below: 0 };
const SKILL_SHARE = 0.8;       // 80% of the score: weighted skill coverage
const EXPERIENCE_SHARE = 0.2;  // 20% of the score: years / seniority / qualification fit

const SEVERITY_BY_IMPORTANCE = { "required": "high", "preferred": "medium", "nice-to-have": "low" };
const SEVERITY_DOWNGRADE = { high: "medium", medium: "low", low: "low" };
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function dedupeSkills(skillAnalysis) {
    const seen = new Map();
    for (const item of skillAnalysis) {
        const key = item.skill.trim().toLowerCase();
        if (!seen.has(key)) seen.set(key, { ...item, skill: item.skill.trim() });
    }
    return [ ...seen.values() ];
}

/**
 * Match score = weighted share of job requirements the candidate demonstrates (80%)
 *             + experience-level fit (20%).
 * Required skills weigh 3, preferred 2, nice-to-have 1. Partial evidence earns half credit.
 */
function calculateMatchScore(skillAnalysis, experienceMatch) {
    let totalWeight = 0;
    let earnedWeight = 0;

    for (const item of skillAnalysis) {
        const weight = IMPORTANCE_WEIGHT[ item.importance ];
        totalWeight += weight;
        earnedWeight += weight * STATUS_CREDIT[ item.status ];
    }

    const skillCoverage = totalWeight > 0 ? earnedWeight / totalWeight : 0;
    const score = (skillCoverage * SKILL_SHARE + EXPERIENCE_CREDIT[ experienceMatch ] * EXPERIENCE_SHARE) * 100;

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Missing skills → severity from how the JD ranks them.
 * A partially demonstrated skill is one level less severe than a fully missing one.
 */
function buildSkillGaps(skillAnalysis) {
    return skillAnalysis
        .filter(item => item.status !== "matched")
        .map(item => {
            const baseSeverity = SEVERITY_BY_IMPORTANCE[ item.importance ];
            return {
                skill: item.skill,
                severity: item.status === "partial" ? SEVERITY_DOWNGRADE[ baseSeverity ] : baseSeverity,
                status: item.status,
                description: item.whyItMatters.trim(),
                topics: item.topics.map(t => t.trim()).filter(Boolean),
                focusAreas: item.focusAreas.map(f => f.trim()).filter(Boolean)
            };
        })
        .sort((a, b) => SEVERITY_ORDER[ a.severity ] - SEVERITY_ORDER[ b.severity ]);
}

async function generateInterviewReport({
    resume,
    selfDescription,
    jobDescription
}) {
    try {
        // Fails fast with a clear AI_NOT_CONFIGURED error when NVIDIA_API_KEY is missing
        getClient();

        const prompt = `
Analyse how well this candidate fits the job, then prepare interview questions.

RESUME:
${resume || "(not provided)"}

CANDIDATE SELF-DESCRIPTION:
${selfDescription || "(not provided)"}

JOB DESCRIPTION:
${jobDescription}

STEP 1 — SKILL ANALYSIS ("skillAnalysis")
List every distinct skill, technology, tool, concept or qualification the JOB DESCRIPTION asks for
(normally 6–15 items; merge duplicates; do not list soft skills like "communication" unless the JD stresses them).
For each item set:
- "importance":
    "required"      = listed under required/must-have, or core to the role's main responsibilities.
    "preferred"     = listed as preferred / plus / bonus, or an important supporting responsibility.
    "nice-to-have"  = mentioned only in passing, optional tools, supplementary knowledge.
- "status", judged ONLY from the resume and self-description:
    "matched"  = clear evidence the candidate has USED it (in a job, internship or project).
    "partial"  = mentioned only as basic/learning/familiar, listed without any usage, or only a closely related technology is shown.
    "missing"  = no evidence at all.
  Be strict and honest. Do not assume skills that are not written. Different candidates must get different results.
- "evidence": short quote or paraphrase from the candidate's profile that supports the status ("" if missing).
- For "partial" and "missing" items ONLY, also give:
    "whyItMatters": one or two sentences explaining why THIS job needs it, referring to the JD.
    "topics": 4–7 specific concepts to learn (e.g. for SQL: "JOINs", "GROUP BY and HAVING", "Indexing and query plans").
    "focusAreas": 2–3 practical things to build or practise that prove the skill.
  For "matched" items use "whyItMatters": "", "topics": [], "focusAreas": [].

STEP 2 — EXPERIENCE ("experienceMatch", "experienceNote")
Compare required years of experience, seniority and degree/qualifications with the candidate:
"meets", "partial" or "below". Explain in one sentence in "experienceNote".

STEP 3 — QUESTIONS
"technicalQuestions": EXACTLY ${TECHNICAL_QUESTION_COUNT} different questions, specific to this role. Cover:
  the core technologies/languages/frameworks in the JD, databases and backend/frontend topics the JD needs,
  the candidate's own projects and work experience, the candidate's missing or partial skills,
  data structures & algorithms or system design when relevant to the role and seniority.
"behavioralQuestions": EXACTLY ${BEHAVIORAL_QUESTION_COUNT} different questions tied to the candidate's experience and the role. Cover:
  problem-solving, teamwork and collaboration, communication, leadership and ownership,
  deadlines and pressure, handling challenges or failure, decision-making, adaptability and learning,
  and realistic workplace/situational scenarios.
Each question has "question", "intention" (what the interviewer is evaluating) and "answer"
(a strong model answer, 60–120 words, using the candidate's real background; never invent achievements or experience).
No duplicate or near-duplicate questions.

"title": the job title from the job description (short, e.g. "Backend Developer (Node.js)").

Return ONE JSON object with exactly this shape:
{
  "title": "",
  "experienceMatch": "meets | partial | below",
  "experienceNote": "",
  "skillAnalysis": [
    { "skill": "", "importance": "required | preferred | nice-to-have", "status": "matched | partial | missing",
      "evidence": "", "whyItMatters": "", "topics": [], "focusAreas": [] }
  ],
  "technicalQuestions": [ { "question": "", "intention": "", "answer": "" } ],
  "behavioralQuestions": [ { "question": "", "intention": "", "answer": "" } ]
}
Return valid JSON only, without Markdown fences.
`;

        // Retry if the model returns an incomplete / invalid report
        const maxAttempts = 3;
        let validatedReport = null;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(
                `Generating interview report (attempt ${attempt}/${maxAttempts})...`
            );

            const response = await getClient().chat.completions.create({
                model: MODEL,

                messages: [
                    {
                        role: "system",
                        content: `You are an expert technical recruiter and interview coach.
Return a valid JSON object only.
You MUST generate exactly ${TECHNICAL_QUESTION_COUNT} technical questions and exactly
${BEHAVIORAL_QUESTION_COUNT} behavioral questions, each with question, intention, and answer.
Judge skills strictly from the candidate's written evidence. Do not omit any required fields.`
                    },
                    {
                        role: "user",
                        content: attempt === 1
                            ? prompt
                            : `${prompt}

IMPORTANT: Your previous response did not satisfy the required schema (${lastError?.message?.slice(0, 300) ?? "invalid"}).
Generate the complete report again. Include ${TECHNICAL_QUESTION_COUNT} technicalQuestions
and ${BEHAVIORAL_QUESTION_COUNT} behavioralQuestions, and whyItMatters + topics for every partial/missing skill.`
                    }
                ],

                response_format: {
                    type: "json_object"
                },

                temperature: 0.2,
                max_tokens: 16000,

                chat_template_kwargs: {
                    enable_thinking: false
                }
            });

            const choice = response.choices?.[0];
            const content = choice?.message?.content;

            if (typeof content !== "string" || !content.trim()) {
                console.error("NVIDIA response details:", {
                    finish_reason: choice?.finish_reason,
                    usage: response.usage
                });

                lastError = new Error(
                    `NVIDIA returned empty content. Finish reason: ${
                        choice?.finish_reason ?? "unknown"
                    }`
                );

                continue;
            }

            let parsedResponse;

            try {
                parsedResponse = JSON.parse(content);
            } catch {
                console.error("Invalid JSON returned by NVIDIA. Finish reason:", choice?.finish_reason);
                lastError = new Error("NVIDIA returned invalid JSON.");
                continue;
            }

            const result = interviewReportSchema.safeParse(stripNulls(parsedResponse));
            if (result.success) {
                validatedReport = result.data;
                break;
            }

            lastError = new Error(result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
            console.error("Schema validation failed:", lastError.message);
            console.log("Technical question count:", parsedResponse.technicalQuestions?.length ?? 0);
            console.log("Behavioral question count:", parsedResponse.behavioralQuestions?.length ?? 0);
        }

        if (!validatedReport) {
            throw new Error(
                `Could not generate a valid report after ${maxAttempts} attempts. ` +
                (lastError?.message ?? "")
            );
        }

        const skillAnalysis = dedupeSkills(validatedReport.skillAnalysis);

        const technicalQuestions = await ensureQuestionCount({
            questions: validatedReport.technicalQuestions, type: "technical",
            target: TECHNICAL_QUESTION_COUNT, resume, selfDescription, jobDescription
        });
        const behavioralQuestions = await ensureQuestionCount({
            questions: validatedReport.behavioralQuestions, type: "behavioral",
            target: BEHAVIORAL_QUESTION_COUNT, resume, selfDescription, jobDescription
        });

        // Return the object (not a JSON string) so the controller can spread it into the model
        return {
            title: validatedReport.title.trim(),
            matchScore: calculateMatchScore(skillAnalysis, validatedReport.experienceMatch),
            experienceMatch: validatedReport.experienceMatch,
            experienceNote: validatedReport.experienceNote.trim(),
            skillAnalysis: skillAnalysis.map(({ skill, importance, status, evidence }) => ({ skill, importance, status, evidence })),
            skillGaps: buildSkillGaps(skillAnalysis),
            technicalQuestions,
            behavioralQuestions
        };

    } catch (error) {
        console.error("Interview Report Error:", error.message);
        throw error;
    }
}


/* ──────────────────────────────────────────────────────────────────────────
 * Resume PDF
 * ────────────────────────────────────────────────────────────────────────── */

function countPdfPages(pdfBuffer) {
    const text = Buffer.from(pdfBuffer).toString("latin1");
    return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
}

/**
 * Converts HTML to an A4 PDF with Puppeteer.
 * With fitToOnePage, the page is scaled down in small steps (never below minScale)
 * until it fits on one page; if it still doesn't fit, the readable multi-page version is kept.
 */
async function generatePdfFromHtml(htmlContent, { fitToOnePage = false, minScale = 0.8 } = {}) {
    const browser = await puppeteer.launch({ args: [ "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage" ] })
    try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: "networkidle0" })

        const render = (scale) => page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            scale
        })

        let pdfBuffer = await render(1)

        if (fitToOnePage && countPdfPages(pdfBuffer) > 1) {
            for (let scale = 0.96; scale >= minScale - 0.001; scale -= 0.04) {
                const candidate = await render(Number(scale.toFixed(2)))
                if (countPdfPages(candidate) === 1) {
                    pdfBuffer = candidate
                    break
                }
            }
        }

        return pdfBuffer
    } finally {
        // Always release Chromium, even if PDF rendering fails
        await browser.close()
    }
}

// The model sometimes returns null for unknown fields; treat null as "not provided"
const stripNulls = (value) => {
    if (Array.isArray(value)) return value.filter(v => v !== null).map(stripNulls);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).filter(([ , v ]) => v !== null).map(([ k, v ]) => [ k, stripNulls(v) ]));
    }
    return value;
};

// The model sometimes returns list items as objects, e.g. a certification as
// { "name": "...", "issuer": "Coursera" }. Join their text values back into one line.
const textItem = z.preprocess(
    (value) => (value && typeof value === "object" && !Array.isArray(value))
        ? Object.values(value).filter(v => typeof v === "string" && v.trim()).map(v => v.trim()).join(" – ")
        : value,
    z.string()
);
const textList = z.array(textItem).transform(items => items.filter(item => item.trim()));

const resumeDataSchema = z.object({
    // May be empty when only a self-description was given — never invent a name
    name: z.string().default(""),
    headline: z.string().default(""),
    contact: z.object({
        location: z.string().default(""),
        email: z.string().default(""),
        phone: z.string().default("")
    }).default({ location: "", email: "", phone: "" }),
    links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
    summary: z.string().default(""),
    skills: z.array(z.object({ category: z.string(), items: textList })).default([]),
    experience: z.array(z.object({
        title: z.string(),
        company: z.string().default(""),
        location: z.string().default(""),
        startDate: z.string().default(""),
        endDate: z.string().default(""),
        bullets: textList.default([])
    })).default([]),
    projects: z.array(z.object({
        name: z.string(),
        techStack: textList.default([]),
        date: z.string().default(""),
        link: z.string().default(""),
        bullets: textList.default([])
    })).default([]),
    education: z.array(z.object({
        degree: z.string(),
        institution: z.string().default(""),
        location: z.string().default(""),
        date: z.string().default(""),
        score: z.string().default("")
    })).default([]),
    certifications: textList.default([]),
    achievements: textList.default([])
});

const escapeHtml = (value = "") => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const normalizeForMatch = (value = "") => String(value).toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").replace(/\s+/g, " ").trim();

/**
 * Guards against fabricated details: contact info, profile links, certifications and achievements
 * are kept only if they can be traced back to what the candidate actually supplied.
 */
function keepOnlySourcedFacts(data, sourceText) {
    const source = normalizeForMatch(sourceText);
    const sourceNoProtocol = source.replace(/https?:\/\//g, "").replace(/www\./g, "");
    const sourceDigits = sourceText.replace(/\D/g, "");

    const linkInSource = (url) => {
        const n = normalizeForMatch(url);
        return n.length > 3 && sourceNoProtocol.includes(n);
    };
    const toHref = (url) => /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;

    const STOP_WORDS = new Set([ "and", "or", "the", "of", "in", "for", "with", "to", "a", "an", "on", "&" ]);
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A word counts as "in the source" if short words match exactly, and longer words share
    // a 6-letter stem (so "optimization" matches "optimized", "indexing" matches "indexes").
    const wordInSource = (word) => word.length <= 3
        ? new RegExp(`(^|[^a-z0-9])${escapeRegex(word)}([^a-z0-9]|$)`).test(source)
        : source.includes(word.slice(0, 6));
    const mostlyInSource = (text) => {
        const words = (text.toLowerCase().match(/[a-z0-9+#]+(?:\.[a-z0-9]+)*/g) || [])
            .filter(w => !STOP_WORDS.has(w));
        if (words.length === 0) return false;
        const found = words.filter(wordInSource).length;
        return found / words.length >= 0.7;
    };

    const contact = data.contact || {};
    const phoneDigits = (contact.phone || "").replace(/\D/g, "");

    return {
        ...data,
        contact: {
            location: contact.location || "",
            email: contact.email && source.includes(contact.email.toLowerCase()) ? contact.email : "",
            phone: phoneDigits.length >= 7 && sourceDigits.includes(phoneDigits.slice(-7)) ? contact.phone : ""
        },
        links: data.links
            .filter(l => l.url && linkInSource(l.url))
            .map(l => ({ label: l.label || l.url, url: toHref(l.url) })),
        // Skills pulled from the JD instead of the candidate's profile are dropped
        skills: data.skills
            .map(s => ({ ...s, items: s.items.filter(mostlyInSource) }))
            .filter(s => s.items.length > 0),
        projects: data.projects.map(p => ({ ...p, link: p.link && linkInSource(p.link) ? toHref(p.link) : "" })),
        certifications: data.certifications.filter(mostlyInSource),
        achievements: data.achievements.filter(mostlyInSource)
    };
}

/**
 * Fixed, single-column, ATS-friendly resume template (no tables, columns, icons or graphics).
 */
function renderResumeHtml(data) {
    const e = escapeHtml;
    const bullets = (items) => items.length
        ? `<ul>${items.map(b => `<li>${e(b)}</li>`).join("")}</ul>` : "";
    const section = (title, body) => body ? `<section><h2>${title}</h2>${body}</section>` : "";
    const dateRange = (start, end) => [ start, end ].filter(Boolean).join(" – ");

    const contactParts = [ data.contact.location, data.contact.email, data.contact.phone ]
        .filter(Boolean).map(e);
    if (data.contact.email) {
        const i = contactParts.indexOf(e(data.contact.email));
        contactParts[ i ] = `<a href="mailto:${e(data.contact.email)}">${e(data.contact.email)}</a>`;
    }
    const linkParts = data.links.map(l =>
        `<a href="${e(l.url)}" target="_blank" rel="noopener noreferrer">${e(l.label)}</a>`);

    const experience = data.experience.map(x => `
        <div class="entry">
            <div class="entry-head">
                <span><strong>${e(x.title)}</strong>${x.company ? ` | ${e(x.company)}` : ""}${x.location ? `, ${e(x.location)}` : ""}</span>
                <span class="date">${e(dateRange(x.startDate, x.endDate))}</span>
            </div>
            ${bullets(x.bullets)}
        </div>`).join("");

    const projects = data.projects.map(p => `
        <div class="entry">
            <div class="entry-head">
                <span><strong>${e(p.name)}</strong>${p.techStack.length ? ` | <span class="tech">${e(p.techStack.join(", "))}</span>` : ""}${p.link ? ` | <a href="${e(p.link)}" target="_blank" rel="noopener noreferrer">Link</a>` : ""}</span>
                <span class="date">${e(p.date)}</span>
            </div>
            ${bullets(p.bullets)}
        </div>`).join("");

    const education = data.education.map(ed => `
        <div class="entry">
            <div class="entry-head">
                <span><strong>${e(ed.degree)}</strong>${ed.institution ? ` | ${e(ed.institution)}` : ""}${ed.location ? `, ${e(ed.location)}` : ""}</span>
                <span class="date">${e(ed.date)}</span>
            </div>
            ${ed.score ? `<p class="sub">${e(ed.score)}</p>` : ""}
        </div>`).join("");

    const skills = data.skills
        .filter(s => s.items.length)
        .map(s => `<p class="skill-row"><strong>${e(s.category)}:</strong> ${e(s.items.join(", "))}</p>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${data.name ? `${e(data.name)} - Resume` : "Resume"}</title>
<style>
    @page { size: A4; margin: 12mm 14mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #000; background: #fff; }
    a { color: #000; text-decoration: underline; }
    header { text-align: center; margin-bottom: 6pt; }
    h1 { font-size: 19pt; font-weight: 700; letter-spacing: 0.5pt; }
    .headline { font-size: 10.5pt; margin-top: 1pt; }
    .contact { font-size: 9.5pt; margin-top: 3pt; }
    .contact .sep { margin: 0 5pt; }
    section { margin-top: 8pt; }
    h2 { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6pt;
         border-bottom: 1px solid #000; padding-bottom: 1.5pt; margin-bottom: 4pt; break-after: avoid; page-break-after: avoid; }
    .entry { margin-bottom: 5pt; break-inside: avoid; page-break-inside: avoid; }
    .entry:last-child { margin-bottom: 0; }
    .entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10pt; }
    .entry-head .date { white-space: nowrap; flex-shrink: 0; }
    .tech { font-style: italic; }
    .sub { font-size: 9.5pt; }
    ul { margin: 2pt 0 0 14pt; }
    li { margin-bottom: 1pt; }
    .skill-row { margin-bottom: 1.5pt; }
</style>
</head>
<body>
    <header>
        ${data.name ? `<h1>${e(data.name)}</h1>` : ""}
        ${data.headline ? `<p class="headline">${e(data.headline)}</p>` : ""}
        ${contactParts.length ? `<p class="contact">${contactParts.join('<span class="sep">|</span>')}</p>` : ""}
        ${linkParts.length ? `<p class="contact">${linkParts.join('<span class="sep">|</span>')}</p>` : ""}
    </header>
    <main>
        ${section("Professional Summary", data.summary ? `<p>${e(data.summary)}</p>` : "")}
        ${section("Technical Skills", skills)}
        ${section("Work Experience", experience)}
        ${section("Projects", projects)}
        ${section("Education", education)}
        ${section("Certifications", bullets(data.certifications))}
        ${section("Achievements", bullets(data.achievements))}
    </main>
</body>
</html>`;
}

async function generateResumePdf({ resume, selfDescription, jobDescription }) {

    const prompt = `You are an expert ATS Resume Writer and Professional Technical Recruiter.

Your task is to extract and tailor the candidate's resume CONTENT for the job description below.
The layout is handled separately by a fixed ATS template — you only return structured content as JSON.

INPUT DATA:

Existing Resume:
${resume || "(not provided)"}

Self Description:
${selfDescription || "(not provided)"}

Job Description:
${jobDescription}

## 1. INFORMATION EXTRACTION AND ANALYSIS
- Extract personal information, education, technical skills, work experience, internships, projects, certifications, achievements, and professional profile links.
- If both resume and self-description are provided, combine their information without duplication.
- Analyze the job description to identify relevant skills, technologies, responsibilities, and ATS keywords.
- Prioritize candidate information that matches the target job and naturally use relevant JD keywords.
- Use professional, action-oriented language and correct grammar.

## 2. CONTENT ACCURACY RULES (MOST IMPORTANT)
- Never invent experience, job titles, companies, dates, skills, CGPA, certifications, achievements, metrics, or project details.
- Never claim technologies that are not supported by the candidate's information.
- Do not fabricate numbers. Keep numbers only if they appear in the candidate's information.
- If information is missing, leave the field empty ("") or the array empty ([]). Never use placeholders.
- "certifications" and "achievements" must ONLY contain items explicitly written by the candidate. If none, return [].
- "skills" must ONLY list skills written in the candidate's resume or self-description — never copy skills from the job description that the candidate does not mention.
- Do not overstate proficiency: avoid words like "expert", "proficient" or "mastery" unless the candidate used them.
- "headline": the candidate's own current role/title from their information (not the target job title). Leave "" if unknown.

## 3. CONTENT GUIDELINES
- "summary": 2–3 lines, job-specific, based only on real experience.
- "skills": group into categories such as Languages, Frontend, Backend, Databases, Cloud & DevOps, Tools, Concepts. Only skills the candidate has. Put JD-relevant skills first.
- "experience": keep EVERY job/internship. 2–4 concise bullets each, starting with strong action verbs.
- "projects": the most relevant projects (up to 4), 2–3 bullets each, with their tech stack.
- "education": degree, institution, location, graduation year/duration, CGPA/percentage if given.
- Dates: use a consistent format such as "Jan 2023" and "Present".
- Keep the wording concise so the resume fits on ONE A4 page when reasonably possible, but never drop real jobs, education, or key facts to do so.

## 4. CONTACT INFORMATION AND LINKS
- Include name, location, phone, and email only if provided.
- "links": LinkedIn, GitHub, LeetCode, Codeforces, portfolio, etc. ONLY when the actual URL or handle path is written in the input
  (e.g. "linkedin.com/in/name"). Use the URL exactly as given. Never generate or guess URLs.

## OUTPUT FORMAT
Return ONLY one valid JSON object with exactly this structure:
{
  "name": "",
  "headline": "",
  "contact": { "location": "", "email": "", "phone": "" },
  "links": [ { "label": "LinkedIn", "url": "" } ],
  "summary": "",
  "skills": [ { "category": "", "items": [] } ],
  "experience": [ { "title": "", "company": "", "location": "", "startDate": "", "endDate": "", "bullets": [] } ],
  "projects": [ { "name": "", "techStack": [], "date": "", "link": "", "bullets": [] } ],
  "education": [ { "degree": "", "institution": "", "location": "", "date": "", "score": "" } ],
  "certifications": [ "Certification name - Issuer" ],
  "achievements": [ "Achievement as one plain-text line" ]
}
No Markdown fences, no explanations, no extra properties.`;

    const response = await getClient().chat.completions.create({
        model: MODEL,
        messages: [
            {
                role: "system",
                content: "You are a senior professional resume writer. Create truthful, personalized, ATS-friendly resume content. Never fabricate candidate information. Return valid JSON only."
            },
            {
                role: "user",
                content: prompt
            }
        ],
        response_format: {
            type: "json_object"
        },
        temperature: 0.2,
        max_tokens: 6000,
        chat_template_kwargs: {
            enable_thinking: false
        }
    });

    const content = response.choices?.[0]?.message?.content;

    if (!content) {
        throw new Error("NVIDIA returned an empty resume response.");
    }

    const resumeData = resumeDataSchema.parse(stripNulls(JSON.parse(content)));
    const safeData = keepOnlySourcedFacts(resumeData, `${resume || ""}\n${selfDescription || ""}`);
    const html = renderResumeHtml(safeData);

    return await generatePdfFromHtml(html, { fitToOnePage: true });
}


module.exports = {
    generateInterviewReport,
    generateResumePdf
};



// const { resume, selfDescription, jobDescription } = require("./temp");

// const OpenAI = require("openai");
// const { z } = require("zod");
// const path = require("path");
// const puppeteer=require("puppeteer")

// require("dotenv").config({
//     path: path.resolve(__dirname, "../../.env")
// });

// const client = new OpenAI({
//     apiKey: process.env.NVIDIA_API_KEY,
//     baseURL: "https://integrate.api.nvidia.com/v1",
//      timeout: 120000, // 120 seconds
//     maxRetries: 2
// });

// const interviewReportSchema = z.object({
//     matchScore: z.number().min(0).max(100),

//     technicalQuestions: z.array(
//         z.object({
//             question: z.string(),
//             intention: z.string(),
//             answer: z.string()
//         })
//     ).length(5),

//     behavioralQuestions: z.array(
//         z.object({
//             question: z.string(),
//             intention: z.string(),
//             answer: z.string()
//         })
//     ).length(5),

//     skillGaps: z.array(
//         z.object({
//             skill: z.string(),
//             severity: z.enum(["low", "medium", "high"]),
//             description: z.string()
//         })
//     ),

//     preparationPlan: z.array(
//         z.object({
//             day: z.number(),
//             focus: z.string(),
//             tasks: z.array(z.string())
//         })
//     )
// });

// async function generateInterviewReport({
//     resume,
//     selfDescription,
//     jobDescription
// }) {
//     try {
//         if (!process.env.NVIDIA_API_KEY) {
//             throw new Error("NVIDIA_API_KEY is missing from Backend/.env");
//         }

//         const prompt = `
// Generate an interview preparation report for the candidate.

// RESUME:
// ${resume}

// CANDIDATE DESCRIPTION:
// ${selfDescription}

// JOB DESCRIPTION:
// ${jobDescription}

// Return one valid JSON object with these fields:

// {
//   "matchScore": 85,
//   "technicalQuestions": [
//     {
//       "question": "Example technical question",
//       "intention": "What this question evaluates",
//       "answer": "A detailed suggested answer"
//     }
//   ],
//   "behavioralQuestions": [
//     {
//       "question": "Example behavioral question",
//       "intention": "What this question evaluates",
//       "answer": "A suggested answer based on the candidate's experience"
//     }
//   ],
//   "skillGaps": [
//     {
//       "skill": "Example skill",
//       "severity": "medium",
//       "description": "What the candidate should improve"
//     }
//   ],
//   "preparationPlan": [
//     {
//       "day": 1,
//       "focus": "Topic to study",
//       "tasks": ["Task 1", "Task 2"]
//     }
//   ]
// }

// STRICT RULES:
// - Generate EXACTLY 5 technicalQuestions.
// - Generate EXACTLY 5 behavioralQuestions.
// - Every question must contain question, intention, and answer.
// - Do not generate just one question in either array.
// - Technical questions must cover different relevant topics from the job description.
// - Behavioral questions must cover different situations, such as teamwork,
//   conflict resolution, problem-solving, ownership, and learning.
// - Answers must be useful, specific, and based on the candidate's background.
// - Do not invent achievements or work experience.
// - matchScore must be a number between 0 and 100.
// - severity must be low, medium, or high.
// - Return valid JSON only, without Markdown fences.
// `;

//         // Retry if NVIDIA returns fewer than 5 questions
//         const maxAttempts = 3;
//         let validatedReport = null;
//         let lastError = null;

//         for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//             console.log(
//                 `Generating interview report (attempt ${attempt}/${maxAttempts})...`
//             );

//             const response = await client.chat.completions.create({
//                 model: "nvidia/nemotron-3.5-lightning-30b-a3b",

//                 messages: [
//                     {
//                         role: "system",
//                         content: `You are an expert interview preparation assistant.
// Return a valid JSON object.
// You MUST generate exactly 5 technical questions and exactly
// 5 behavioral questions, each with question, intention, and answer.
// Do not omit any required fields.`
//                     },
//                     {
//                         role: "user",
//                         content: attempt === 1
//                             ? prompt
//                             : `${prompt}

// IMPORTANT: Your previous response did not satisfy the required schema.
// Generate the complete report again. Include exactly 5 technicalQuestions
// and exactly 5 behavioralQuestions. Do not return partial arrays.`
//                     }
//                 ],

//                 response_format: {
//                     type: "json_object"
//                 },

//                 temperature: 0.2,
//                 max_tokens: 8000,

//                 chat_template_kwargs: {
//                     enable_thinking: false
//                 }
//             });

//             const choice = response.choices?.[0];
//             const content = choice?.message?.content;

//             if (typeof content !== "string" || !content.trim()) {
//                 console.error("NVIDIA response details:", {
//                     finish_reason: choice?.finish_reason,
//                     message: choice?.message,
//                     usage: response.usage
//                 });

//                 lastError = new Error(
//                     `NVIDIA returned empty content. Finish reason: ${
//                         choice?.finish_reason ?? "unknown"
//                     }`
//                 );

//                 continue;
//             }

//             let parsedResponse;

//             try {
//                 parsedResponse = JSON.parse(content);
//             } catch (error) {
//                 console.error("Invalid JSON returned by NVIDIA:", content);
//                 lastError = new Error("NVIDIA returned invalid JSON.");
//                 continue;
//             }

//             try {
//                 validatedReport = interviewReportSchema.parse(parsedResponse);
//                 break;
//             } catch (error) {
//                 lastError = error;

//                 console.error("Schema validation failed:", error.issues);

//                 console.log("Technical question count:",
//                     parsedResponse.technicalQuestions?.length ?? 0);

//                 console.log("Behavioral question count:",
//                     parsedResponse.behavioralQuestions?.length ?? 0);
//             }
//         }

//         if (!validatedReport) {
//             throw new Error(
//                 `Could not generate a valid report after ${maxAttempts} attempts. ` +
//                 (lastError?.message ?? "")
//             );
//         }

//         return JSON.stringify(validatedReport, null, 2);

//         // return validatedReport;

//     } catch (error) {
//         console.error("Interview Report Error:", error.message);
//         throw error;
//     }
// }

// async function generatePdfFromHtml(htmlContent) {
//     const browser = await puppeteer.launch({ args: [ "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage" ] })
//     const page = await browser.newPage();
//     await page.setContent(htmlContent, { waitUntil: "networkidle0" })

//     const pdfBuffer = await page.pdf({
//         format: "A4", margin: {
//             top: "20mm",
//             bottom: "20mm",
//             left: "15mm",
//             right: "15mm"
//         }
//     })

//     await browser.close()

//     return pdfBuffer
// }

// async function generateResumePdf({ resume, selfDescription, jobDescription }) {

//     const resumePdfSchema = z.object({
//         html: z.string().describe("The HTML content of the resume which can be converted to PDF using any library like puppeteer")
//     })

//     const prompt = `Generate resume for a candidate with the following details:
//                         Resume: ${resume}
//                         Self Description: ${selfDescription}
//                         Job Description: ${jobDescription}

//                         the response should be a JSON object with a single field "html" which contains the HTML content of the resume which can be converted to PDF using any library like puppeteer.
//                         The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience. The HTML content should be well-formatted and structured, making it easy to read and visually appealing.
//                         The content of resume should be not sound like it's generated by AI and should be as close as possible to a real human-written resume.
//                         you can highlight the content using some colors or different font styles but the overall design should be simple and professional.
//                         The content should be ATS friendly, i.e. it should be easily parsable by ATS systems without losing important information.
//                         The resume should not be so lengthy, it should ideally be 1-2 pages long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description.
//                     `

//     const response = await ai.models.generateContent({
//         model: "gemini-3-flash-preview",
//         contents: prompt,
//         config: {
//             responseMimeType: "application/json",
//             responseSchema: zodToJsonSchema(resumePdfSchema),
//         }
//     })


//     const jsonContent = JSON.parse(response.text)

//     const pdfBuffer = await generatePdfFromHtml(jsonContent.html)

//     return pdfBuffer

// }

// module.exports = {
//     generateInterviewReport,
//     generateResumePdf
// };
