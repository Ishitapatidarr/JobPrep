
const { resume, selfDescription, jobDescription } = require("./temp");

const OpenAI = require("openai");
const { z } = require("zod");
const path = require("path");

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

module.exports = {
    generateInterviewReport
};
