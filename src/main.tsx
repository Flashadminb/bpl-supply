import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { ErrorBoundary } from './components/ErrorBoundary'
import { UpdatePrompt } from './components/UpdatePrompt'
import { CartProvider } from './lib/cart'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* นอกสุด ดักได้แม้แต่ตอน provider พังเอง */}
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <App />
            <UpdatePrompt />
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
