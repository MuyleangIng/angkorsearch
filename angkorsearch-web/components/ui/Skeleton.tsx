import { cn } from '@/lib/utils'

interface Props { className?: string }

export function SkeletonLine({ className }: Props) {
  return (
    <div className={cn('animate-shimmer rounded bg-hover', className)} />
  )
}

export function ResultSkeleton() {
  return (
    <div className="py-4 border-b border-border space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full animate-shimmer bg-hover" />
        <SkeletonLine className="h-3 w-48" />
      </div>
      <SkeletonLine className="h-5 w-3/4" />
      <SkeletonLine className="h-3 w-full" />
      <SkeletonLine className="h-3 w-5/6" />
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <SkeletonLine className="h-36 w-full rounded-lg" />
      <SkeletonLine className="h-4 w-2/3" />
      <SkeletonLine className="h-3 w-full" />
      <SkeletonLine className="h-3 w-4/5" />
    </div>
  )
}

export default function Skeleton() {
  return (
    <div className="space-y-1">
      {[1, 2, 3, 4].map(i => <ResultSkeleton key={i} />)}
    </div>
  )
}
