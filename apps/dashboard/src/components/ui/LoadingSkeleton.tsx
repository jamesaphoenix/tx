interface LoadingSkeletonProps {
  count?: number
}

export function LoadingSkeleton({ count = 1 }: LoadingSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={`skeleton-${i}`}
          className="animate-shimmer bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 bg-[length:200%_100%] rounded-lg h-20"
        />
      ))}
    </>
  )
}
