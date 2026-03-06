import Skeleton from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col min-h-screen bg-primary">
      {/* Header placeholder */}
      <div className="sticky top-0 z-40 bg-card border-b border-border h-[88px]" />
      <div className="flex-1 flex justify-center">
        <div className="w-full max-w-5xl px-4 py-5">
          <Skeleton />
        </div>
      </div>
    </div>
  )
}
