const pdfParse = require("pdf-parse")
const mongoose = require("mongoose")
const { z } = require("zod")
const { generateInterviewReport, generateResumePdf } = require("../services/ai.service")
const interviewReportModel = require("../models/interviewReport.model")

const AI_NOT_CONFIGURED_MESSAGE = "AI features are not configured on the server (NVIDIA_API_KEY is missing). Please contact the administrator."


/**
 * @description Request validation for generating a report.
 * Job description is required; at least one of resume file / self description must be present.
 */
const generateReportInputSchema = z.object({
    jobDescription: z.string().trim().min(1, "Job description is required.").max(5000, "Job description must be 5000 characters or fewer."),
    selfDescription: z.string().trim().optional().default(""),
    hasResume: z.boolean()
}).refine(data => data.hasResume || data.selfDescription.length > 0, {
    message: "Please upload a resume or enter a self description.",
    path: [ "selfDescription" ]
})


/**
 * @description Controller to generate interview report based on user self description, resume and job description.
 */
async function generateInterViewReportController(req, res) {

    const parsed = generateReportInputSchema.safeParse({
        jobDescription: req.body?.jobDescription ?? "",
        selfDescription: req.body?.selfDescription ?? "",
        hasResume: Boolean(req.file)
    })

    if (!parsed.success) {
        return res.status(400).json({
            message: parsed.error.issues[ 0 ].message
        })
    }

    const { jobDescription, selfDescription } = parsed.data

    let resumeText = ""
    if (req.file) {
        try {
            const resumeContent = await (new pdfParse.PDFParse(Uint8Array.from(req.file.buffer))).getText()
            resumeText = resumeContent.text?.trim() ?? ""
        } catch (err) {
            console.error("Resume parse error:", err.message)
            return res.status(400).json({
                message: "Could not read the uploaded resume. Please upload a valid, text-based PDF."
            })
        }

        if (!resumeText && !selfDescription) {
            return res.status(400).json({
                message: "No text could be extracted from the resume. Please upload a text-based PDF or add a self description."
            })
        }
    }

    let interViewReportByAi
    try {
        interViewReportByAi = await generateInterviewReport({
            resume: resumeText,
            selfDescription,
            jobDescription
        })
    } catch (err) {
        console.error("AI generation failed:", err.message)
        if (err.code === "AI_NOT_CONFIGURED") {
            return res.status(503).json({ message: AI_NOT_CONFIGURED_MESSAGE })
        }
        return res.status(502).json({
            message: "The AI service could not generate your interview plan. Please try again in a moment."
        })
    }

    try {
        const interviewReport = await interviewReportModel.create({
            user: req.user.id,
            resume: resumeText,
            selfDescription,
            jobDescription,
            ...interViewReportByAi
        })

        res.status(201).json({
            message: "Interview report generated successfully.",
            interviewReport
        })
    } catch (err) {
        console.error("Saving interview report failed:", err.message)
        res.status(500).json({
            message: "Your interview plan was generated but could not be saved. Please try again."
        })
    }

}

/**
 * @description Controller to get interview report by interviewId.
 */
async function getInterviewReportByIdController(req, res) {

    const { interviewId } = req.params

    if (!mongoose.isValidObjectId(interviewId)) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    const interviewReport = await interviewReportModel.findOne({ _id: interviewId, user: req.user.id })

    if (!interviewReport) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    res.status(200).json({
        message: "Interview report fetched successfully.",
        interviewReport
    })
}


/** 
 * @description Controller to get all interview reports of logged in user.
 */
async function getAllInterviewReportsController(req, res) {
    const interviewReports = await interviewReportModel.find({ user: req.user.id }).sort({ createdAt: -1 }).select("-resume -selfDescription -jobDescription -__v -technicalQuestions -behavioralQuestions -skillGaps -skillAnalysis -preparationPlan")

    res.status(200).json({
        message: "Interview reports fetched successfully.",
        interviewReports
    })
}


/**
 * @description Controller to generate resume PDF based on user self description, resume and job description.
 */
async function generateResumePdfController(req, res) {
    const { interviewReportId } = req.params

    if (!mongoose.isValidObjectId(interviewReportId)) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    // Scope to the logged-in user so one user can't download another user's resume
    const interviewReport = await interviewReportModel.findOne({ _id: interviewReportId, user: req.user.id })

    if (!interviewReport) {
        return res.status(404).json({
            message: "Interview report not found."
        })
    }

    const { resume, jobDescription, selfDescription } = interviewReport

    let pdfBuffer
    try {
        pdfBuffer = await generateResumePdf({ resume, jobDescription, selfDescription })
    } catch (err) {
        console.error("Resume PDF generation failed:", err.message)
        if (err.code === "AI_NOT_CONFIGURED") {
            return res.status(503).json({ message: AI_NOT_CONFIGURED_MESSAGE })
        }
        return res.status(502).json({
            message: "Could not generate your resume PDF. Please try again in a moment."
        })
    }

    res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=resume_${interviewReportId}.pdf`
    })

    res.send(Buffer.from(pdfBuffer))
}

module.exports = { generateInterViewReportController, getInterviewReportByIdController, getAllInterviewReportsController, generateResumePdfController }