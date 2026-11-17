import React, { useState } from 'react'
import '../style/interview.scss'
import { useInterview } from '../hooks/useInterview.js'
import { useNavigate, useParams } from 'react-router'
import LogoutButton from '../../auth/components/LogoutButton.jsx'



const NAV_ITEMS = [
    { id: 'technical', label: 'Technical Questions', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>) },
    { id: 'behavioral', label: 'Behavioral Questions', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>) },
    { id: 'roadmap', label: 'Road Map', icon: (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>) },
]

// ── Sub-components ────────────────────────────────────────────────────────────
const QuestionCard = ({ item, index }) => {
    const [ open, setOpen ] = useState(false)
    return (
        <div className='q-card'>
            <div className='q-card__header' onClick={() => setOpen(o => !o)}>
                <span className='q-card__index'>Q{index + 1}</span>
                <p className='q-card__question'>{item.question}</p>
                <span className={`q-card__chevron ${open ? 'q-card__chevron--open' : ''}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </span>
            </div>
            {open && (
                <div className='q-card__body'>
                    <div className='q-card__section'>
                        <span className='q-card__tag q-card__tag--intention'>Intention</span>
                        <p>{item.intention}</p>
                    </div>
                    <div className='q-card__section'>
                        <span className='q-card__tag q-card__tag--answer'>Model Answer</span>
                        <p>{item.answer}</p>
                    </div>
                </div>
            )}
        </div>
    )
}

const SEVERITY_GROUPS = [
    { id: 'high', label: 'High Severity', hint: 'Core requirements for this role' },
    { id: 'medium', label: 'Medium Severity', hint: 'Important supporting skills' },
    { id: 'low', label: 'Low Severity', hint: 'Useful, but not essential' },
]

const SkillGapCard = ({ gap }) => (
    <div className={`gap-card gap-card--${gap.severity}`}>
        <div className='gap-card__header'>
            <h3 className='gap-card__skill'>{gap.skill}</h3>
            {gap.status && (
                <span className='gap-card__status'>{gap.status === 'partial' ? 'Partially demonstrated' : 'Missing'}</span>
            )}
        </div>

        {gap.description && (
            <p className='gap-card__why'><strong>Why it matters:</strong> {gap.description}</p>
        )}

        {gap.topics?.length > 0 && (
            <div className='gap-card__block'>
                <p className='gap-card__label'>Topics to learn</p>
                <ul className='gap-card__topics'>
                    {gap.topics.map((topic, i) => <li key={i}>{topic}</li>)}
                </ul>
            </div>
        )}

        {gap.focusAreas?.length > 0 && (
            <div className='gap-card__block'>
                <p className='gap-card__label'>Practical focus</p>
                <ul className='gap-card__focus'>
                    {gap.focusAreas.map((area, i) => <li key={i}>{area}</li>)}
                </ul>
            </div>
        )}

        {!gap.topics?.length && !gap.description && (
            <p className='gap-card__legacy'>Learning recommendations aren't available for this older plan. Generate a new plan to get them.</p>
        )}
    </div>
)

const SkillGapRoadmap = ({ skillGaps }) => {
    if (!skillGaps.length) {
        return (
            <p className='roadmap-empty'>
                No missing skills found — your profile covers the requirements in this job description.
            </p>
        )
    }

    return (
        <div className='gap-groups'>
            {SEVERITY_GROUPS.map(group => {
                const gaps = skillGaps.filter(g => g.severity === group.id)
                return (
                    <div key={group.id} className={`gap-group gap-group--${group.id}`}>
                        <div className='gap-group__header'>
                            <span className='gap-group__dot' />
                            <h3>{group.label}</h3>
                            <span className='gap-group__count'>{gaps.length}</span>
                            <span className='gap-group__hint'>{group.hint}</span>
                        </div>
                        {gaps.length > 0 ? (
                            <div className='gap-group__list'>
                                {gaps.map((gap, i) => <SkillGapCard key={`${gap.skill}-${i}`} gap={gap} />)}
                            </div>
                        ) : (
                            <p className='gap-group__none'>No {group.id}-severity gaps.</p>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

// ── Main Component ────────────────────────────────────────────────────────────
const Interview = () => {
    const [ activeNav, setActiveNav ] = useState('technical')
    // useInterview already fetches the report for :interviewId on mount
    const { report, loading, reportError, getResumePdf } = useInterview()
    const { interviewId } = useParams()
    const navigate = useNavigate()
    const [ downloading, setDownloading ] = useState(false)
    const [ downloadError, setDownloadError ] = useState("")

    const handleDownloadResume = async () => {
        setDownloading(true)
        setDownloadError("")
        try {
            await getResumePdf(interviewId)
        } catch (error) {
            setDownloadError(error.message)
        } finally {
            setDownloading(false)
        }
    }

    if (reportError && !loading) {
        return (
            <main className='loading-screen loading-screen--error'>
                <h1>{reportError}</h1>
                <button className='button primary-button' onClick={() => navigate('/')}>Back to Home</button>
            </main>
        )
    }

    // Also wait if the context still holds a different (previously opened) plan
    if (loading || !report || report._id !== interviewId) {
        return (
            <main className='loading-screen'>
                <h1>Loading your interview plan...</h1>
            </main>
        )
    }

    const scoreColor =
        report.matchScore >= 80 ? 'score--high' :
            report.matchScore >= 60 ? 'score--mid' : 'score--low'

    const skillGaps = report.skillGaps || []
    const skillAnalysis = report.skillAnalysis || []
    const matchedSkills = skillAnalysis.filter(s => s.status === 'matched')


    return (
        <div className='interview-page'>
            <div className='interview-layout'>

                {/* ── Left Nav ── */}
                <nav className='interview-nav'>
                    <div className="nav-content">
                        <p className='interview-nav__label'>Sections</p>
                        {NAV_ITEMS.map(item => (
                            <button
                                key={item.id}
                                className={`interview-nav__item ${activeNav === item.id ? 'interview-nav__item--active' : ''}`}
                                onClick={() => setActiveNav(item.id)}
                            >
                                <span className='interview-nav__icon'>{item.icon}</span>
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <div className='interview-nav__actions'>
                    {downloadError && <p className='interview-nav__error' role='alert'>{downloadError}</p>}
                    <button
                        onClick={handleDownloadResume}
                        disabled={downloading}
                        className='button primary-button' >
                        <svg height={"0.8rem"} style={{ marginRight: "0.8rem" }} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10.6144 17.7956 11.492 15.7854C12.2731 13.9966 13.6789 12.5726 15.4325 11.7942L17.8482 10.7219C18.6162 10.381 18.6162 9.26368 17.8482 8.92277L15.5079 7.88394C13.7092 7.08552 12.2782 5.60881 11.5105 3.75894L10.6215 1.61673C10.2916.821765 9.19319.821767 8.8633 1.61673L7.97427 3.75892C7.20657 5.60881 5.77553 7.08552 3.97685 7.88394L1.63658 8.92277C.868537 9.26368.868536 10.381 1.63658 10.7219L4.0523 11.7942C5.80589 12.5726 7.21171 13.9966 7.99275 15.7854L8.8704 17.7956C9.20776 18.5682 10.277 18.5682 10.6144 17.7956ZM19.4014 22.6899 19.6482 22.1242C20.0882 21.1156 20.8807 20.3125 21.8695 19.8732L22.6299 19.5353C23.0412 19.3526 23.0412 18.7549 22.6299 18.5722L21.9121 18.2532C20.8978 17.8026 20.0911 16.9698 19.6586 15.9269L19.4052 15.3156C19.2285 14.8896 18.6395 14.8896 18.4628 15.3156L18.2094 15.9269C17.777 16.9698 16.9703 17.8026 15.956 18.2532L15.2381 18.5722C14.8269 18.7549 14.8269 19.3526 15.2381 19.5353L15.9985 19.8732C16.9874 20.3125 17.7798 21.1156 18.2198 22.1242L18.4667 22.6899C18.6473 23.104 19.2207 23.104 19.4014 22.6899Z"></path></svg>
                        {downloading ? 'Generating PDF...' : 'Download Resume'}
                    </button>
                    <LogoutButton className='interview-nav__logout' />
                    </div>
                </nav>

                <div className='interview-divider' />

                {/* ── Center Content ── */}
                <main className='interview-content'>
                    {activeNav === 'technical' && (
                        <section>
                            <div className='content-header'>
                                <h2>Technical Questions</h2>
                                <span className='content-header__count'>{report.technicalQuestions.length} questions</span>
                            </div>
                            <div className='q-list'>
                                {report.technicalQuestions.map((q, i) => (
                                    <QuestionCard key={i} item={q} index={i} />
                                ))}
                            </div>
                        </section>
                    )}

                    {activeNav === 'behavioral' && (
                        <section>
                            <div className='content-header'>
                                <h2>Behavioral Questions</h2>
                                <span className='content-header__count'>{report.behavioralQuestions.length} questions</span>
                            </div>
                            <div className='q-list'>
                                {report.behavioralQuestions.map((q, i) => (
                                    <QuestionCard key={i} item={q} index={i} />
                                ))}
                            </div>
                        </section>
                    )}

                    {activeNav === 'roadmap' && (
                        <section>
                            <div className='content-header'>
                                <h2>Missing Skills &amp; Learning Recommendations</h2>
                                <span className='content-header__count'>{skillGaps.length} {skillGaps.length === 1 ? 'skill' : 'skills'}</span>
                            </div>
                            <SkillGapRoadmap skillGaps={skillGaps} />
                        </section>
                    )}
                </main>

                <div className='interview-divider' />

                {/* ── Right Sidebar ── */}
                <aside className='interview-sidebar'>

                    {/* Match Score */}
                    <div className='match-score'>
                        <p className='match-score__label'>Match Score</p>
                        <div className={`match-score__ring ${scoreColor}`} style={{ '--score': report.matchScore }}>
                            <span className='match-score__value'>{report.matchScore}</span>
                            <span className='match-score__pct'>%</span>
                        </div>
                        <p className={`match-score__sub ${scoreColor}`}>
                            {report.matchScore >= 80 ? 'Strong match for this role' :
                                report.matchScore >= 60 ? 'Good match for this role' : 'Needs improvement for this role'}
                        </p>
                        {skillAnalysis.length > 0 && (
                            <p className='match-score__basis'>
                                {matchedSkills.length} of {skillAnalysis.length} job skills matched
                                {report.experienceNote ? <><br />{report.experienceNote}</> : null}
                            </p>
                        )}
                    </div>

                    {matchedSkills.length > 0 && (
                        <>
                            <div className='sidebar-divider' />
                            <div className='skill-gaps'>
                                <p className='skill-gaps__label'>Matched Skills</p>
                                <div className='skill-gaps__list'>
                                    {matchedSkills.map((s, i) => (
                                        <span key={i} className='skill-tag skill-tag--matched' title={s.evidence || undefined}>
                                            {s.skill}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    <div className='sidebar-divider' />

                    {/* Skill Gaps */}
                    <div className='skill-gaps'>
                        <p className='skill-gaps__label'>Skill Gaps</p>
                        <div className='skill-gaps__list'>
                            {skillGaps.map((gap, i) => (
                                <span key={i} className={`skill-tag skill-tag--${gap.severity}`}>
                                    {gap.skill}
                                </span>
                            ))}
                        </div>
                        {skillGaps.length === 0 && <p className='skill-gaps__none'>No skill gaps found.</p>}
                    </div>

                </aside>
            </div>
        </div>
    )
}

export default Interview