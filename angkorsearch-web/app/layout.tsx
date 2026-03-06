import type { Metadata } from 'next'
import { Noto_Sans, Noto_Sans_Khmer } from 'next/font/google'
import { ThemeProvider } from '@/lib/theme'
import './globals.css'

const notoSans = Noto_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto',
  display: 'swap',
})

const notoSansKhmer = Noto_Sans_Khmer({
  subsets: ['khmer'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-khmer',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'AngkorSearch — Cambodia\'s Open Search Engine',
    template: '%s | AngkorSearch',
  },
  description: 'Search the web in Khmer and English. Cambodia\'s open-source search engine powered by AI.',
  keywords: ['Cambodia', 'Khmer', 'search engine', 'AngkorSearch'],
  metadataBase: new URL('http://localhost:3001'),
  openGraph: {
    type: 'website',
    locale: 'km_KH',
    alternateLocale: 'en_US',
    siteName: 'AngkorSearch',
  },
  icons: { icon: '/logo.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="km" className={`dark ${notoSans.variable} ${notoSansKhmer.variable}`} suppressHydrationWarning>
      <body className="min-h-screen flex flex-col">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
