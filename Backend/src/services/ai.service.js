const { resume, selfDescription, jobDescription } = require("./temp");

const OpenAI = require("openai");
const { z } = require("zod");
const path = require("path");
const puppeteer=require("puppeteer")

require("dotenv").config({
    path: path.resolve(__dirname, "../../.env")
});

const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: "https://integrate.api.nvidia.com/v1",
     timeout: 120000, // 120 seconds
    maxRetries: 2
});

const interviewReportSchema = z.object({
    matchScore: z.number().min(0).max(100),

    technicalQuestions: z.array(
        z.object({
            question: z.string(),
            intention: z.string(),
            answer: z.string()
        })
    ).length(5),

    behavioralQuestions: z.array(
        z.object({
            question: z.string(),
            intention: z.string(),
            answer: z.string()
        })
    ).length(5),

    skillGaps: z.array(
        z.object({
            skill: z.string(),
            severity: z.enum(["low", "medium", "high"]),
            description: z.string()
        })
    ),

    preparationPlan: z.array(
        z.object({
            day: z.number(),
            focus: z.string(),
            tasks: z.array(z.string())
        })
    )
});

async function generateInterviewReport({
    resume,
    selfDescription,
    jobDescription
}) {
    try {
        if (!process.env.NVIDIA_API_KEY) {
            throw new Error("NVIDIA_API_KEY is missing from Backend/.env");
        }

        const prompt = `
Generate an interview preparation report for the candidate.

RESUME:
${resume}

CANDIDATE DESCRIPTION:
${selfDescription}

JOB DESCRIPTION:
${jobDescription}

Return one valid JSON object with these fields:

{
  "matchScore": 85,
  "technicalQuestions": [
    {
      "question": "Example technical question",
      "intention": "What this question evaluates",
      "answer": "A detailed suggested answer"
    }
  ],
  "behavioralQuestions": [
    {
      "question": "Example behavioral question",
      "intention": "What this question evaluates",
      "answer": "A suggested answer based on the candidate's experience"
    }
  ],
  "skillGaps": [
    {
      "skill": "Example skill",
      "severity": "medium",
      "description": "What the candidate should improve"
    }
  ],
  "preparationPlan": [
    {
      "day": 1,
      "focus": "Topic to study",
      "tasks": ["Task 1", "Task 2"]
    }
  ]
}

STRICT RULES:
- Generate EXACTLY 5 technicalQuestions.
- Generate EXACTLY 5 behavioralQuestions.
- Every question must contain question, intention, and answer.
- Do not generate just one question in either array.
- Technical questions must cover different relevant topics from the job description.
- Behavioral questions must cover different situations, such as teamwork,
  conflict resolution, problem-solving, ownership, and learning.
- Answers must be useful, specific, and based on the candidate's background.
- Do not invent achievements or work experience.
- matchScore must be a number between 0 and 100.
- severity must be low, medium, or high.
- Return valid JSON only, without Markdown fences.
`;

        // Retry if NVIDIA returns fewer than 5 questions
        const maxAttempts = 3;
        let validatedReport = null;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(
                `Generating interview report (attempt ${attempt}/${maxAttempts})...`
            );

            const response = await client.chat.completions.create({
                model: "nvidia/nemotron-3.5-lightning-30b-a3b",

                messages: [
                    {
                        role: "system",
                        content: `You are an expert interview preparation assistant.
Return a valid JSON object.
You MUST generate exactly 5 technical questions and exactly
5 behavioral questions, each with question, intention, and answer.
Do not omit any required fields.`
                    },
                    {
                        role: "user",
                        content: attempt === 1
                            ? prompt
                            : `${prompt}

IMPORTANT: Your previous response did not satisfy the required schema.
Generate the complete report again. Include exactly 5 technicalQuestions
and exactly 5 behavioralQuestions. Do not return partial arrays.`
                    }
                ],

                response_format: {
                    type: "json_object"
                },

                temperature: 0.2,
                max_tokens: 8000,

                chat_template_kwargs: {
                    enable_thinking: false
                }
            });

            const choice = response.choices?.[0];
            const content = choice?.message?.content;

            if (typeof content !== "string" || !content.trim()) {
                console.error("NVIDIA response details:", {
                    finish_reason: choice?.finish_reason,
                    message: choice?.message,
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
            } catch (error) {
                console.error("Invalid JSON returned by NVIDIA:", content);
                lastError = new Error("NVIDIA returned invalid JSON.");
                continue;
            }

            try {
                validatedReport = interviewReportSchema.parse(parsedResponse);
                break;
            } catch (error) {
                lastError = error;

                console.error("Schema validation failed:", error.issues);

                console.log("Technical question count:",
                    parsedResponse.technicalQuestions?.length ?? 0);

                console.log("Behavioral question count:",
                    parsedResponse.behavioralQuestions?.length ?? 0);
            }
        }

        if (!validatedReport) {
            throw new Error(
                `Could not generate a valid report after ${maxAttempts} attempts. ` +
                (lastError?.message ?? "")
            );
        }

        return JSON.stringify(validatedReport, null, 2);

        // return validatedReport;

    } catch (error) {
        console.error("Interview Report Error:", error.message);
        throw error;
    }
}

async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch()
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" })

    const pdfBuffer = await page.pdf({
        format: "A4", margin: {
            top: "20mm",
            bottom: "20mm",
            left: "15mm",
            right: "15mm"
        }
    })

    await browser.close()

    return pdfBuffer
}



async function generateResumePdf({ resume, selfDescription, jobDescription }) {
    const resumePdfSchema = z.object({
        html: z.string()
    });

    const prompt = `You are an expert ATS Resume Writer, Professional Technical Recruiter, and Resume Designer.

Your task is to generate a highly professional, ATS-friendly, job-specific resume in HTML format using the candidate information and job description provided below.

The candidate may provide:
1. Existing resume content (optional).
2. Self-description (optional).
3. Job description (required).

At least one of the resume or self-description inputs will be provided.

INPUT DATA:

Existing Resume:
${resume}

Self Description:
${selfDescription}

Job Description:
${jobDescription}

## 1. INFORMATION EXTRACTION AND ANALYSIS

- Extract personal information, education, technical skills, work experience, internships, projects, certifications, achievements, and professional profile links.
- If both resume and self-description are provided, intelligently combine their information without duplication.
- Use self-description to supplement and improve existing resume information.
- Analyze the job description to identify relevant skills, technologies, qualifications, responsibilities, and ATS keywords.
- Prioritize candidate information that matches the target job.
- Naturally incorporate relevant JD keywords throughout the resume.
- Use professional, action-oriented language.
- Correct grammatical errors and improve sentence structure.

## 2. CONTENT ACCURACY RULES

- Never invent experience, job titles, companies, dates, skills, CGPA, certifications, achievements, or project details.
- Never claim expertise in technologies that are not supported by the candidate's information.
- Do not fabricate achievements or numerical improvements.
- Preserve factual information from the original resume.
- If information is missing, omit it instead of making assumptions.
- Do not add irrelevant information just to increase ATS keyword matching.
- Do not include empty sections or placeholders.

## 3. RESUME STRUCTURE

Generate the resume using the following sections, depending on available information:

1. Candidate Name and Contact Information
2. Professional Summary
3. Technical Skills
4. Work Experience / Internships
5. Projects
6. Education
7. Certifications and Achievements

Adjust the section ordering based on the target job and candidate experience.

## 4. PROFESSIONAL SUMMARY

- Write a concise, job-specific summary of 2–4 lines.
- Highlight relevant experience, technical strengths, and specialization.
- Align the summary with the target job description.
- Avoid generic statements and unnecessary personal information.

## 5. TECHNICAL SKILLS

Organize skills into appropriate categories:

- Programming Languages
- Frontend Technologies
- Backend Technologies
- Databases
- Cloud and DevOps
- Developer Tools
- Core Computer Science Concepts

Only include relevant categories and skills supported by the supplied information.

Prioritize technologies mentioned in the job description when the candidate possesses those skills.

## 6. WORK EXPERIENCE

For each experience or internship:

- Display job title and company name on the left.
- Display location where available.
- Display employment date at the extreme right of the same line.
- Write 2–4 concise bullet points.
- Start each bullet point with strong action verbs.
- Focus on responsibilities, implementation, contributions, and measurable achievements.
- Highlight relevant technologies and tools.
- Maintain a visible vertical gap between two different work experiences.

Example layout:

Software Developer Intern | ABC Technologies                         Mar 2024 – Jun 2024

• Developed REST APIs using Node.js and Express.js.
• Integrated MongoDB for database management.
• Implemented authentication and authorization functionality.

## 7. PROJECTS

- Select the most relevant projects according to the job description.
- Arrange projects in descending order of relevance.
- Display project name and technology stack on the left.
- Display project date/year at the extreme right of the same line.
- Include 2–3 meaningful bullet points for every project.
- Explain what was developed, how it was implemented, and its important functionalities.
- Highlight relevant technologies, APIs, database integration, authentication, automation, and deployment.
- Avoid repetitive descriptions.
- Maintain sufficient vertical spacing between projects.

Example:

E-Commerce Backend | Node.js, Express.js, MongoDB                  Jan 2025

• Developed REST APIs for product, user, and order management.
• Implemented JWT authentication and role-based authorization.
• Integrated MongoDB for persistent data storage.

## 8. EDUCATION

Include:
- University / College Name
- Degree and Specialization
- CGPA / Percentage (if provided)
- Location
- Graduation Year / Duration

Align dates at the extreme right of the same line.

## 9. CERTIFICATIONS AND ACHIEVEMENTS

- Include relevant certifications, technical achievements, competitive programming achievements, and other accomplishments.
- Prioritize certifications relevant to the target job.
- Use concise bullet points.

## 10. CONTACT INFORMATION AND CLICKABLE LINKS

- Include candidate name, location, phone number, and email if provided.
- Include LinkedIn, GitHub, LeetCode, Codeforces, portfolio, or other professional profile links ONLY when actual URLs are provided.
- Make profile names clickable using HTML anchor tags.
- Each link must open the correct profile URL.
- Use target="_blank" and rel="noopener noreferrer".
- Never generate fake URLs.
- Never display empty profile labels or placeholders.
- Do not display a profile name as a clickable link if its URL is unavailable.

Example:

<a href="https://linkedin.com/in/example" target="_blank" rel="noopener noreferrer">LinkedIn</a>

## 11. ATS-FRIENDLY HTML DESIGN

Generate a complete, valid HTML document with embedded CSS.

Follow these design requirements:

PAGE LAYOUT:
- A4 page size.
- Prefer a single-page resume.
- Use a clean, traditional, single-column resume layout.
- White background with black text.
- Professional typography.
- Appropriate margins and consistent spacing.
- Do not overcrowd the page.

HEADER:
- Candidate name centered at the top.
- Contact details directly below the name.
- Professional profile links displayed only when actual URLs exist.

SECTION HEADINGS:
- Use bold, uppercase section headings.
- Add a thin horizontal line below each heading.
- Add sufficient vertical spacing before and after every section.

EXPERIENCE AND PROJECTS:
- Job titles and project names aligned to the left.
- Employment dates and project dates aligned to the extreme right of the same line.
- Use CSS Flexbox for date alignment.
- Add a visible gap between different work experiences and projects.
- Use standard bullet points.
- Keep bullet points concise and readable.

ATS COMPATIBILITY:
- Use semantic HTML elements such as header, main, section, h1, h2, p, ul, and li.
- Use a single-column layout.
- Avoid tables for resume content.
- Avoid images, icons, charts, skill bars, and graphical elements.
- Avoid complex CSS positioning.
- Keep all important resume information as selectable HTML text.
- Use standard section headings that ATS software can recognize.
- Use simple, consistent fonts such as Arial, Calibri, or Helvetica.
- Use approximately 9–11px or equivalent readable print typography only when necessary; prioritize readability.
- Ensure the document is printable and compatible with Puppeteer PDF generation.

SPACING:
- Add consistent gaps after each section.
- Add extra spacing between separate work experiences.
- Add extra spacing between individual projects.
- Ensure dates remain aligned to the far-right edge.
- Prevent headings from being separated from their content.

PAGE BREAKS:
- Prefer a single-page resume when the candidate's information allows it.
- Never remove important information or make text unreadably small just to fit one page.
- Use a second page when necessary.
- Use appropriate print CSS and page-break handling.

## 12. FINAL QUALITY CHECK

Before generating HTML:

- Verify spelling and grammar.
- Verify all dates and employment durations.
- Check that dates are aligned to the extreme right.
- Check that projects contain 2–3 meaningful bullet points.
- Check that work experiences have sufficient spacing.
- Remove duplicate information.
- Verify technical skills against the supplied information.
- Verify that all profile links are genuine and clickable.
- Ensure the resume is tailored to the job description.
- Ensure the HTML is valid and self-contained.
- Ensure there are no empty sections or placeholder content.

## 13. FINAL HTML REQUIREMENTS

- Generate a complete HTML5 document.
- Include <!DOCTYPE html>, html, head, meta charset, meta viewport, title, style, and body elements.
- Put all CSS inside a style tag.
- Do not use external CSS frameworks, external fonts, JavaScript libraries, or image assets.
- Use print-friendly CSS with @page { size: A4; }.
- Make the HTML compatible with Puppeteer page.setContent() and PDF generation.
- The generated HTML must reproduce the professional single-column resume design described above.

## OUTPUT FORMAT:

Return ONLY a valid JSON object in exactly this structure:

{"html":"<complete HTML document>"}

IMPORTANT:
- Escape all special characters and quotation marks correctly so the response is valid JSON.
- The HTML must be contained entirely inside the "html" string.
- Do not return Markdown code fences.
- Do not include explanations, comments, or any text outside the JSON object.
- Do not return additional JSON properties.
- Ensure the JSON can be parsed directly using JSON.parse().
- The HTML must contain the complete resume and all embedded CSS.`;

    const response = await client.chat.completions.create({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        messages: [
            {
                role: "system",
                content: "You are a senior professional resume writer and designer. Create truthful, personalized, ATS-friendly resumes. Never fabricate candidate information. Return valid JSON only."
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

    const jsonContent = JSON.parse(content);
    const validatedContent = resumePdfSchema.parse(jsonContent);

    return await generatePdfFromHtml(validatedContent.html);
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
//     const browser = await puppeteer.launch()
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
