import React, { useState, useRef, useContext } from 'react'
import "../style/home.scss"
import { useInterview } from '../hooks/useInterview.js'
import { useNavigate } from 'react-router'
import { AuthContext } from '../../auth/auth.context.jsx'
import LogoutButton from '../../auth/components/LogoutButton.jsx'

// Must match the backend upload limit in Backend/src/middlewares/file.middleware.js
const MAX_RESUME_SIZE = 3 * 1024 * 1024

const Home = () => {

    const { loading, generateReport, reports, reportsLoading, reportsError } = useInterview()
    // Read the user directly from context (useAuth would trigger another /get-me request)
    const { user } = useContext(AuthContext)
    const [ jobDescription, setJobDescription ] = useState("")
    const [ selfDescription, setSelfDescription ] = useState("")
    const [ resumeFile, setResumeFile ] = useState(null)
    const [ formError, setFormError ] = useState("")
    const resumeInputRef = useRef()
    const resumeFileName = resumeFile?.name || ""
    const jobDescriptionLength = jobDescription.length

    const navigate = useNavigate()

    const validateResumeFile = (file) => {
        if (!file) return ""
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
        if (!isPdf) return "Please upload your resume as a PDF file."
        if (file.size > MAX_RESUME_SIZE) return "Resume file is too large. Maximum size is 3MB."
        return ""
    }

    const handleResumeChange = (e) => {
        const file = e.target.files[ 0 ] || null
        const error = validateResumeFile(file)
        if (error) {
            setFormError(error)
            setResumeFile(null)
            e.target.value = ""
            return
        }
        setFormError("")
        setResumeFile(file)
    }

    const handleGenerateReport = async () => {
        if (!jobDescription.trim()) {
            setFormError("Please enter the target job description.")
            return
        }
        if (!resumeFile && !selfDescription.trim()) {
            setFormError("Please upload a resume or enter a self description.")
            return
        }
        const fileError = validateResumeFile(resumeFile)
        if (fileError) {
            setFormError(fileError)
            return
        }

        setFormError("")
        try {
            const data = await generateReport({ jobDescription, selfDescription, resumeFile })
            navigate(`/interview/${data._id}`)
        } catch (error) {
            setFormError(error.message)
        }
    }

    if (loading) {
        return (
            <main className='loading-screen'>
                <h1>Loading your interview plan...</h1>
            </main>
        )
    }

    return (
        <div className='home-page'>

            {/* Top bar: signed-in user + logout */}
            <div className='top-bar'>
                <div className='user-chip'>
                    {user?.username && (
                        <>
                            <span className='user-chip__avatar' aria-hidden='true'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                            </span>
                            <span className='user-chip__text'>
                                <span className='user-chip__label'>Signed in as</span>
                                <span className='user-chip__name' title={user.username}>{user.username}</span>
                            </span>
                            <span className='user-chip__divider' aria-hidden='true' />
                        </>
                    )}
                    <LogoutButton className='logout--inline' />
                </div>
            </div>

            {/* Page Header */}
            <header className='page-header'>
               <h1>Get Interview-Ready <span className="highlight">with AI</span></h1>
<p>Analyze your profile, discover skill gaps, and get personalized interview questions and learning recommendations to prepare for your dream role.</p>
            </header>

            {/* Main Card */}
            <div className='interview-card'>
                <div className='interview-card__body'>

                    {/* Left Panel - Job Description */}
                    <div className='panel panel--left'>
                        <div className='panel__header'>
                            <span className='panel__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                            </span>
                            <h2>Target Job Description</h2>
                            <span className='badge badge--required'>Required</span>
                        </div>
                        <textarea
                            value={jobDescription}
                            onChange={(e) => { setJobDescription(e.target.value) }}
                            className='panel__textarea'
                            placeholder={`Paste the full job description here...\ne.g. 'Senior Frontend Engineer at Google requires proficiency in React, TypeScript, and large-scale system design...'`}
                            maxLength={5000}
                        />
                        <div className={`char-counter${jobDescriptionLength >= 5000 ? ' char-counter--full' : jobDescriptionLength >= 4500 ? ' char-counter--near' : ''}`}>{jobDescriptionLength} / 5000 chars</div>
                    </div>

                    {/* Vertical Divider */}
                    <div className='panel-divider' />

                    {/* Right Panel - Profile */}
                    <div className='panel panel--right'>
                        <div className='panel__header'>
                            <span className='panel__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                            </span>
                            <h2>Your Profile</h2>
                        </div>

                        {/* Upload Resume */}
                        <div className='upload-section'>
                            <label className='section-label'>
                                Upload Resume
                                
                            </label>
                            <label className={`dropzone${resumeFileName ? ' dropzone--has-file' : ''}`} htmlFor='resume'>
                                <span className='dropzone__icon'>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" /></svg>
                                </span>
                                <p className='dropzone__title'>Click to upload or drag &amp; drop</p>
                                <p className='dropzone__subtitle'>PDF only (Max 3MB)</p>
                                {resumeFileName && <span className='dropzone__file'>{resumeFileName}</span>}
                                <input ref={resumeInputRef} hidden type='file' id='resume' name='resume' accept='.pdf,application/pdf' onChange={handleResumeChange} />
                            </label>
                        </div>

                        {/* OR Divider */}
                        <div className='or-divider'><span>OR</span></div>

                        {/* Quick Self-Description */}
                        <div className='self-description'>
                            <label className='section-label' htmlFor='selfDescription'>Quick Self-Description</label>
                            <textarea
                                value={selfDescription}
                                onChange={(e) => { setSelfDescription(e.target.value) }}
                                id='selfDescription'
                                name='selfDescription'
                                className='panel__textarea panel__textarea--short'
                                placeholder="Briefly describe your experience, key skills, and years of experience if you don't have a resume handy..."
                            />
                        </div>

                        {/* Info Box */}
                        <div className='info-box'>
                            <span className='info-box__icon'>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" stroke="#1a1f27" strokeWidth="2" /><line x1="12" y1="16" x2="12.01" y2="16" stroke="#1a1f27" strokeWidth="2" /></svg>
                            </span>
                            <p>Either a <strong>Resume</strong> or a <strong>Self Description</strong> is required to generate your personalized interview plan.</p>
                        </div>
                    </div>
                </div>

                {formError && (
                    <div className='form-error' role='alert'>{formError}</div>
                )}

                {/* Card Footer */}
                <div className='interview-card__footer'>
                   
                    <button
                        onClick={handleGenerateReport}
                        disabled={loading}
                        className='button primary-button generate-btn'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" /></svg>
                        Generate My Interview Strategy
                    </button>
                </div>
            </div>

            {/* Recent Reports List */}
            <section className='recent-reports'>
                <h2>My Recent Interview Plans</h2>
                {reportsLoading && reports.length === 0 ? (
                    <p className='reports-state'>Loading your interview plans...</p>
                ) : reportsError ? (
                    <p className='reports-state reports-state--error'>{reportsError}</p>
                ) : reports.length === 0 ? (
                    <p className='reports-state'>No interview plans yet. Generate your first plan above and it will appear here.</p>
                ) : (
                    <ul className='reports-list'>
                        {reports.map(report => (
                            <li key={report._id} className='report-item' onClick={() => navigate(`/interview/${report._id}`)}>
                                <h3>{report.title || 'Untitled Position'}</h3>
                                <p className='report-meta'>Generated on {new Date(report.createdAt).toLocaleDateString()}</p>
                                <p className={`match-score ${report.matchScore >= 80 ? 'score--high' : report.matchScore >= 60 ? 'score--mid' : 'score--low'}`}>Match Score: {report.matchScore}%</p>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            
        </div>
    )
}

export default Home