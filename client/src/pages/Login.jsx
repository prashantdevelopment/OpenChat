import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthContext.js'

const Login = () => {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  // Logging in now also unlocks the encryption key (PBKDF2 takes a moment).
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { currentUser, login } = useAuth()
  const location = useLocation()

    const handleLogin = async (e) => {
        e.preventDefault()
        setError('')
        setIsSubmitting(true)

        try{
            await login(identifier, password)
        } catch (error) {
            setError(error.response?.data?.message ?? 'Could not reach the server. Please try again.')
            setIsSubmitting(false)
        }

    }

  // Already logged in (or just logged in): go where the user wanted to go.
  if (currentUser) {
    return <Navigate to={location.state?.from ?? '/chat'} replace />
  }

  return (
    <div>
        <form onSubmit={handleLogin}>
            {error ? <p role='alert'>{error}</p> : null}
            <input type="text"
            placeholder = "Email or Username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            />
            <input type="password"
            placeholder = "Password"
            autoComplete='current-password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            />
            <button disabled={isSubmitting}>{isSubmitting ? 'Logging in...' : 'Login'}</button>
        </form>
        <p>
            No account yet? <Link to='/register'>Create one</Link>
        </p>
    </div>
  )
}

export default Login
