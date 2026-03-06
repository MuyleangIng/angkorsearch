import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-border py-5 mt-auto">
      <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted">
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-center sm:text-left">
          <span>🇰🇭 AngkorSearch — Cambodia&apos;s open search engine</span>
          <span className="hidden sm:inline text-border">|</span>
          <span className="flex items-center gap-1">
            Made with <span className="text-red mx-0.5">♥</span> by{' '}
            <a href="https://muyleanging.com" target="_blank" rel="noreferrer" className="text-blue hover:underline ml-1">
              Ing Muyleang
            </a>
            <span className="mx-1.5 text-border">|</span>
            <a href="https://khmerstack.muyleanging.com" target="_blank" rel="noreferrer" className="text-blue hover:underline">
              KhmerStack
            </a>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/about" className="hover:text-content transition-colors">About</Link>
          <Link href="/admin" className="hover:text-content transition-colors">Admin</Link>
        </div>
      </div>
    </footer>
  )
}
