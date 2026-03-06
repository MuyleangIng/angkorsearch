import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-border py-5 mt-auto">
      <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted">
        <span>🇰🇭 AngkorSearch — Cambodia&apos;s open search engine</span>
        <div className="flex items-center gap-4">
          <Link href="/admin" className="hover:text-content transition-colors">Admin Dashboard</Link>
          <a href="http://localhost:8080/stats" className="hover:text-content transition-colors">API Stats</a>
        </div>
      </div>
    </footer>
  )
}
