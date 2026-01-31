import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LoadingSkeleton } from '../LoadingSkeleton'

describe('LoadingSkeleton', () => {
  it('renders default single skeleton item', () => {
    const { container } = render(<LoadingSkeleton />)
    const skeletons = container.querySelectorAll('div')
    expect(skeletons).toHaveLength(1)
  })

  it('renders correct number of skeleton items', () => {
    const { container } = render(<LoadingSkeleton count={5} />)
    const skeletons = container.querySelectorAll('div')
    expect(skeletons).toHaveLength(5)
  })

  it('renders zero items when count is 0', () => {
    const { container } = render(<LoadingSkeleton count={0} />)
    const skeletons = container.querySelectorAll('div')
    expect(skeletons).toHaveLength(0)
  })

  it('has shimmer animation class', () => {
    const { container } = render(<LoadingSkeleton />)
    const skeleton = container.querySelector('div')
    expect(skeleton).toHaveClass('animate-shimmer')
  })

  it('has gradient background classes', () => {
    const { container } = render(<LoadingSkeleton />)
    const skeleton = container.querySelector('div')
    expect(skeleton).toHaveClass('bg-gradient-to-r')
    expect(skeleton).toHaveClass('from-gray-800')
    expect(skeleton).toHaveClass('via-gray-700')
    expect(skeleton).toHaveClass('to-gray-800')
  })

  it('has correct background size for animation', () => {
    const { container } = render(<LoadingSkeleton />)
    const skeleton = container.querySelector('div')
    expect(skeleton).toHaveClass('bg-[length:200%_100%]')
  })
})
