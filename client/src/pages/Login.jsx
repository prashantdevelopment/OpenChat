import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import api from '../api/api.js'
import { useAuth } from '../auth/AuthContext.js'

const Login = () => {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const { currentUser, setCurrentUser } = useAuth()
  const location = useLocation()

    const handleLogin = async (e) => {
        e.preventDefault()

        try{
            const response = await api.post('/auth/login', { identifier, password })

                setIdentifier('')
                setPassword('')
                setCurrentUser(response.data.user)
        } catch (error) {
            console.error('Error logging in:', error)
        }

    }

  // Already logged in (or just logged in): go where the user wanted to go.
  if (currentUser) {
    return <Navigate to={location.state?.from ?? '/chat'} replace />
  }

  return (
    <div>
        <form onSubmit={handleLogin}>
            <input type="text"
            placeholder = "Email or Username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            />
            <input type="password"
            placeholder = "Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            />
            <button>Login</button>
        </form>
    </div>
  )
}

export default Login
