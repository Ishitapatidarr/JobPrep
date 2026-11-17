import { useContext, useState } from "react"
import { useNavigate } from "react-router"
import { useAuth } from "../hooks/useAuth"
import { InterviewContext } from "../../interview/interview.context.jsx"
import "../style/logout-button.scss"

/**
 * Logout button: calls the existing backend logout (JWT blacklist + cookie clear),
 * clears auth + interview state, and redirects to /login.
 */
const LogoutButton = ({ className = "" }) => {
    const { handleLogout } = useAuth()
    const interviewContext = useContext(InterviewContext)
    const navigate = useNavigate()
    const [ pending, setPending ] = useState(false)
    const [ error, setError ] = useState("")

    const onLogout = async () => {
        setPending(true)
        setError("")
        try {
            await handleLogout()

            // Don't leave the previous user's plans in memory
            if (interviewContext) {
                interviewContext.setReport(null)
                interviewContext.setReports([])
                interviewContext.setReportError("")
                interviewContext.setReportsError("")
            }

            // replace: the Back button shouldn't return to a protected page
            navigate("/login", { replace: true })
        } catch (err) {
            setError(err.message)
            setPending(false)
        }
    }

    return (
        <div className={`logout ${className}`}>
            {error && <p className='logout__error' role='alert'>{error}</p>}
            <button
                type='button'
                className='logout__button'
                onClick={onLogout}
                disabled={pending}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                {pending ? "Logging out..." : "Logout"}
            </button>
        </div>
    )
}

export default LogoutButton
