import React,{useState} from 'react'
import { useNavigate, Link } from 'react-router'
import "../auth.form.scss"
import { useAuth } from '../hooks/useAuth'
import "../auth.form.scss"

const Login = () => {

    const { loading, handleLogin } = useAuth()
    const navigate = useNavigate()

    const [ email, setEmail ] = useState("")
    const [ password, setPassword ] = useState("")
    const [ error, setError ] = useState("")

    const handleSubmit = async (e) => {
        e.preventDefault()
        // await handleLogin({email,password})
        // navigate('/')

        if (!email.trim() || !password) {
            setError("Please enter your email and password.")
            return
        }

        setError("")
        try {
            await handleLogin({ email, password })
            navigate('/')
        } catch (err) {
            setError(err.message)
        }
    }

    // if(loading){
    //     return (<main><h1>Loading.......</h1></main>)
    // }
if (loading) {
    return (
        <main className="loading-page">
            <div className="loader-container">
                <div className="loader"></div>
                <span>Loading...</span>
            </div>
        </main>
    )
}

    return (
        <main>
            <div className="form-container">
                <h1>Login</h1>
                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label htmlFor="email">Email</label>
                        <input
                            value={email}
                            onChange={(e) => { setEmail(e.target.value) }}
                            type="email" id="email" name='email' placeholder='Enter email address' />
                    </div>
                    <div className="input-group">
                        <label htmlFor="password">Password</label>
                        <input
                            value={password}
                            onChange={(e) => { setPassword(e.target.value) }}
                            type="password" id="password" name='password' placeholder='Enter password' />
                    </div>
                    {error && <p className='form-message form-message--error' role='alert'>{error}</p>}
                    <button className='button primary-button' >Login</button>
                </form>
                <p>Don't have an account? <Link to={"/register"} >Register</Link> </p>
            </div>
        </main>
    )
}

export default Login