import { cn } from '@/lib/utils'

interface Props {
  variant: 'km' | 'en' | 'type' | 'tag'
  children: React.ReactNode
  className?: string
}

const variants = {
  km:   'bg-yellow-900/20 text-yellow-400 border border-yellow-700/40',
  en:   'bg-blue-900/20 text-blue-400 border border-blue-700/30',
  type: 'bg-hover text-muted border border-border',
  tag:  'bg-blue-950/40 text-blue-400 border border-blue-800/40',
}

export default function Badge({ variant, children, className }: Props) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      variants[variant],
      className,
    )}>
      {children}
    </span>
  )
}
