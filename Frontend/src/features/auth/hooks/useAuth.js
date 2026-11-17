import { useContext, useEffect } from "react";
import { AuthContext } from "../auth.context";
import { login, register, logout, getMe } from "../services/auth.api";



export const useAuth = () => {

    const context = useContext(AuthContext)
    const { user, setUser, loading, setLoading } = context


    // const handleLogin = async ({ email, password }) => {
    //     setLoading(true)
    //     try {
    //         const data = await login({ email, password })
    //         setUser(data.user)
    //     } catch (err) {

    //     } finally {
    //         setLoading(false)
    //     }
    // }

    const handleLogin = async ({ email, password }) => {
    setLoading(true)

    try {
        const data = await login({ email, password })
        setUser(data.user)
        return data
    } catch (err) {
        console.error("Login error:", err)
        throw err
    } finally {
        setLoading(false)
    }
}

    const handleRegister = async ({ username, email, password }) => {
        setLoading(true)
        try {
            const data = await register({ username, email, password })
            setUser(data.user)
        } catch (err) {

        } finally {
            setLoading(false)
        }
    }

    /**
     * Logs out via the backend (blacklists the JWT and clears the cookie), then clears auth state.
     * Doesn't toggle the global `loading` flag, so the current page (and any error message) stays mounted.
     * Throws an Error with a user-friendly message if the logout could not be completed.
     */
    const handleLogout = async () => {
        try {
            await logout()
        } catch (err) {
            // 401 = the session had already expired / been invalidated, so the user is effectively logged out
            if (err?.response?.status !== 401) {
                const message = err?.response
                    ? (err.response.data?.message || "Logout failed. Please try again.")
                    : "Cannot reach the server. Please check your connection and try again."
                throw new Error(message, { cause: err })
            }
        }
        setUser(null)
    }

    useEffect(() => {

        const getAndSetUser = async () => {
            try {

                const data = await getMe()
                setUser(data.user)
            } catch (err) { } finally {
                setLoading(false)
            }
        }

        getAndSetUser()

    }, [])

    return { user, loading, handleRegister, handleLogin, handleLogout }
}