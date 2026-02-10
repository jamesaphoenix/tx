import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

describe('App', () => {
  it('renders without crashing', () => {
    renderWithProviders(<App />)
    // Basic smoke test - verify dashboard header renders
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('tx')
  })
})
