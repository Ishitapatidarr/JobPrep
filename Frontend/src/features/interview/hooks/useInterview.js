import { getAllInterviewReports, generateInterviewReport, getInterviewReportById, generateResumePdf, getApiErrorMessage } from "../services/interview.api"
import { useContext, useEffect } from "react"
import { InterviewContext } from "../interview.context"
import { useParams } from "react-router"


export const useInterview = () => {

    const context = useContext(InterviewContext)
    const { interviewId } = useParams()

    if (!context) {
        throw new Error("useInterview must be used within an InterviewProvider")
    }

    const {
        loading, setLoading, report, setReport, reports, setReports,
        reportsLoading, setReportsLoading, reportError, setReportError, reportsError, setReportsError
    } = context

    /**
     * Generates a new plan. Throws an Error with a user-friendly message on failure,
     * so the caller can show it and avoid navigating.
     */
    const generateReport = async ({ jobDescription, selfDescription, resumeFile }) => {
        setLoading(true)
        try {
            const response = await generateInterviewReport({ jobDescription, selfDescription, resumeFile })
            const newReport = response?.interviewReport
            if (!newReport?._id) {
                throw new Error("The server returned an empty interview plan. Please try again.")
            }
            setReport(newReport)
            // Put the new plan at the top of the recent list straight away
            setReports(prev => [ newReport, ...prev.filter(r => r._id !== newReport._id) ])
            return newReport
        } catch (error) {
            console.log(error)
            const message = error?.isAxiosError
                ? await getApiErrorMessage(error, "Could not generate your interview plan. Please try again.")
                : error.message
            throw new Error(message, { cause: error })
        } finally {
            setLoading(false)
        }
    }

    const getReportById = async (interviewId) => {
        setLoading(true)
        setReportError("")
        try {
            const response = await getInterviewReportById(interviewId)
            setReport(response.interviewReport)
            return response.interviewReport
        } catch (error) {
            console.log(error)
            setReport(null)
            setReportError(await getApiErrorMessage(error, "Could not load this interview plan."))
            return null
        } finally {
            setLoading(false)
        }
    }

    const getReports = async () => {
        setReportsLoading(true)
        setReportsError("")
        try {
            const response = await getAllInterviewReports()
            setReports(response.interviewReports)
            return response.interviewReports
        } catch (error) {
            console.log(error)
            setReportsError(await getApiErrorMessage(error, "Could not load your recent interview plans."))
            return []
        } finally {
            setReportsLoading(false)
        }
    }

    /**
     * Downloads the generated resume PDF. Throws an Error with a user-friendly message on failure.
     * Uses its own loading flag in the caller so the results page stays on screen.
     */
    const getResumePdf = async (interviewReportId) => {
        try {
            const response = await generateResumePdf({ interviewReportId })
            const url = window.URL.createObjectURL(new Blob([ response ], { type: "application/pdf" }))
            const link = document.createElement("a")
            link.href = url
            link.setAttribute("download", `resume_${interviewReportId}.pdf`)
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.URL.revokeObjectURL(url)
        }
        catch (error) {
            console.log(error)
            throw new Error(await getApiErrorMessage(error, "Could not generate your resume PDF. Please try again."), { cause: error })
        }
    }

    useEffect(() => {
        if (interviewId) {
            getReportById(interviewId)
        } else {
            getReports()
        }
    }, [ interviewId ])

    return {
        loading, report, reports, reportsLoading, reportError, reportsError,
        generateReport, getReportById, getReports, getResumePdf
    }

}
