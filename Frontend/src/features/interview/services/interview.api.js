import axios from "axios";

const api = axios.create({
    baseURL: "http://localhost:3000",
    withCredentials: true,
})


/**
 * @description Service to generate interview report based on user self description, resume and job description.
 */
export const generateInterviewReport = async ({ jobDescription, selfDescription, resumeFile }) => {

    const formData = new FormData()
    formData.append("jobDescription", jobDescription)
    formData.append("selfDescription", selfDescription || "")
    // Only attach the file when one was chosen; appending undefined sends the string "undefined"
    if (resumeFile) {
        formData.append("resume", resumeFile)
    }

    const response = await api.post("/api/interview/", formData)

    return response.data

}


/**
 * @description Turn an axios error into a user-friendly message.
 * Handles JSON error bodies, Blob error bodies (PDF download), network errors and expired sessions.
 */
export const getApiErrorMessage = async (error, fallback = "Something went wrong. Please try again.") => {
    if (!error?.response) {
        return "Cannot reach the server. Please check that the backend is running and try again."
    }

    if (error.response.status === 401) {
        return "Your session has expired. Please log in again."
    }

    let data = error.response.data
    if (data instanceof Blob) {
        try {
            data = JSON.parse(await data.text())
        } catch {
            data = null
        }
    }

    return data?.message || fallback
}


/**
 * @description Service to get interview report by interviewId.
 */
export const getInterviewReportById = async (interviewId) => {
    const response = await api.get(`/api/interview/report/${interviewId}`)

    return response.data
}


/**
 * @description Service to get all interview reports of logged in user.
 */
export const getAllInterviewReports = async () => {
    const response = await api.get("/api/interview/")

    return response.data
}


/**
 * @description Service to generate resume pdf based on user self description, resume content and job description.
 */
export const generateResumePdf = async ({ interviewReportId }) => {
    const response = await api.post(`/api/interview/resume/pdf/${interviewReportId}`, null, {
        responseType: "blob"
    })

    return response.data
}