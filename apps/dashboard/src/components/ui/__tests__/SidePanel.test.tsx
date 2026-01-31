import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidePanel } from '../SidePanel'

describe('SidePanel', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Panel Title',
    children: <div>Panel content</div>,
  }

  it('renders title and children when open', () => {
    render(<SidePanel {...defaultProps} />)
    expect(screen.getByText('Panel Title')).toBeInTheDocument()
    expect(screen.getByText('Panel content')).toBeInTheDocument()
  })

  it('is visible when isOpen is true', () => {
    const { container } = render(<SidePanel {...defaultProps} isOpen={true} />)
    // Panel should have translate-x-0 (visible) class
    const panel = container.querySelector('.w-\\[480px\\]')
    expect(panel).toHaveClass('translate-x-0')
    expect(panel).not.toHaveClass('translate-x-full')
  })

  it('is not visible when isOpen is false', () => {
    const { container } = render(<SidePanel {...defaultProps} isOpen={false} />)
    // Panel should have translate-x-full (hidden) class
    const panel = container.querySelector('.w-\\[480px\\]')
    expect(panel).toHaveClass('translate-x-full')
    expect(panel).not.toHaveClass('translate-x-0')
  })

  it('backdrop has pointer-events-none when closed', () => {
    const { container } = render(<SidePanel {...defaultProps} isOpen={false} />)
    // Backdrop is the first fixed div
    const backdrop = container.querySelector('.fixed.inset-0')
    expect(backdrop).toHaveClass('pointer-events-none')
  })

  it('backdrop is interactive when open', () => {
    const { container } = render(<SidePanel {...defaultProps} isOpen={true} />)
    const backdrop = container.querySelector('.fixed.inset-0')
    expect(backdrop).not.toHaveClass('pointer-events-none')
  })

  it('escape key calls onClose', () => {
    const onClose = vi.fn()
    render(<SidePanel {...defaultProps} onClose={onClose} isOpen={true} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('escape key does not call onClose when panel is closed', () => {
    const onClose = vi.fn()
    render(<SidePanel {...defaultProps} onClose={onClose} isOpen={false} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('backdrop click calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(
      <SidePanel {...defaultProps} onClose={onClose} isOpen={true} />
    )

    const backdrop = container.querySelector('.fixed.inset-0')
    await user.click(backdrop!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('close button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SidePanel {...defaultProps} onClose={onClose} isOpen={true} />)

    const closeButton = screen.getByRole('button', { name: 'Close panel' })
    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking panel content does not call onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SidePanel {...defaultProps} onClose={onClose} isOpen={true} />)

    await user.click(screen.getByText('Panel content'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('has correct panel width', () => {
    const { container } = render(<SidePanel {...defaultProps} />)
    const panel = container.querySelector('.w-\\[480px\\]')
    expect(panel).toBeInTheDocument()
  })
})
