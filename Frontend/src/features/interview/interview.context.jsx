import { createContext,useState } from "react";


export const InterviewContext = createContext()

export const InterviewProvider = ({ children }) => {
    const [loading, setLoading] = useState(false)
    const [report, setReport] = useState(null)
    const [reports, setReports] = useState([])
    const [reportsLoading, setReportsLoading] = useState(false)
    const [reportError, setReportError] = useState("")
    const [reportsError, setReportsError] = useState("")

    return (
        <InterviewContext.Provider value={{
            loading, setLoading, report, setReport, reports, setReports,
            reportsLoading, setReportsLoading, reportError, setReportError, reportsError, setReportsError
        }}>
            {children}
        </InterviewContext.Provider>
    )
}