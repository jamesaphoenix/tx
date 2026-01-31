import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from '../EmptyState'

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No items found" />)
    expect(screen.getByText('No items found')).toBeInTheDocument()
  })

  it('renders title and description', () => {
    render(
      <EmptyState
        title="No items found"
        description="Try adjusting your search criteria"
      />
    )
    expect(screen.getByText('No items found')).toBeInTheDocument()
    expect(screen.getByText('Try adjusting your search criteria')).toBeInTheDocument()
  })

  it('renders optional icon', () => {
    render(
      <EmptyState
        title="No results"
        icon={<span data-testid="custom-icon">Icon</span>}
      />
    )
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('does not render icon container when icon is not provided', () => {
    const { container } = render(<EmptyState title="No items" />)
    // The icon container has text-4xl class
    const iconContainer = container.querySelector('.text-4xl')
    expect(iconContainer).not.toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    render(<EmptyState title="No items" />)
    // Should only have the title, no description paragraph
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument()
  })

  it('renders optional action button', () => {
    render(
      <EmptyState
        title="No items"
        action={<button>Add item</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument()
  })

  it('action callback fires on click', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()

    render(
      <EmptyState
        title="No items"
        action={<button onClick={handleClick}>Add item</button>}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add item' }))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('has centered layout', () => {
    const { container } = render(<EmptyState title="Test" />)
    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center')
  })
})
