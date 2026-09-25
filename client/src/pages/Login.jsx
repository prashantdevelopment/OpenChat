import { useState } from 'react'
import axios from 'axios'

const Login = ({ setCurrentUser }) => {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

    const handleLogin = async (e) => {
        e.preventDefault()

        try{
            const response = await axios.post('http://localhost:5000/api/auth/login', 
                {
                    identifier,
                    password
                },
                {
                    withCredentials: true
                }
            )
                setIdentifier('')
                setPassword('')
                setCurrentUser(response.data.user)
        } catch (error) {
            console.error('Error logging in:', error)
        }

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