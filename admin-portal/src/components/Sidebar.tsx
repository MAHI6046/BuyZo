'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Package, 
  Tags, 
  Settings, 
  ShoppingBag,
  BadgeDollarSign,
  TicketPercent,
  ChartNoAxesCombined,
  Trophy,
  ReceiptText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/lib/store';
import { X } from 'lucide-react';

const menuItems = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { name: 'Products', icon: Package, href: '/products' },
  { name: 'Categories', icon: Tags, href: '/categories' },
  { name: 'Pricing', icon: BadgeDollarSign, href: '/pricing' },
  { name: 'Promos', icon: TicketPercent, href: '/promos' },
  { name: 'Orders', icon: ReceiptText, href: '/orders' },
  { name: 'Analytics', icon: ChartNoAxesCombined, href: '/analytics' },
  { name: 'Top Items', icon: Trophy, href: '/top-items' },
  { name: 'Settings', icon: Settings, href: '/settings' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { isSidebarOpen, closeSidebar } = useUIStore();

  const sidebarContent = (
    <div className="flex flex-col h-full bg-surface border-r border-border">
      <div className="p-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3" onClick={closeSidebar}>
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
            <ShoppingBag className="text-white w-6 h-6" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">
            BuyZo <span className="text-primary">Admin</span>
          </span>
        </Link>
        <button 
          onClick={closeSidebar}
          className="lg:hidden p-2 hover:bg-primary/10 rounded-lg text-foreground/40 hover:text-primary transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              prefetch={false}
              onClick={closeSidebar}
              className={cn(
                "flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group",
                isActive 
                  ? "bg-primary text-white shadow-md shadow-primary/20" 
                  : "text-foreground/60 hover:bg-primary/5 hover:text-primary"
              )}
            >
              <div className="flex items-center gap-3">
                <item.icon className={cn("w-5 h-5", isActive ? "text-white" : "group-hover:text-primary")} />
                <span className="font-medium">{item.name}</span>
              </div>
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="w-1.5 h-1.5 rounded-full bg-white"
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 mt-auto">
        <div className="bg-white/50 border border-border rounded-2xl p-4">
          <p className="text-xs text-foreground/40 font-medium uppercase tracking-wider mb-2">Support</p>
          <p className="text-sm text-foreground/70 mb-3">Need help with the portal?</p>
          <button className="w-full py-2 bg-foreground text-white rounded-lg text-sm font-medium hover:bg-foreground/90 transition-colors">
            Contact Support
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-64 hidden lg:block z-50">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeSidebar}
              className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-[60] lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 h-screen w-[280px] max-w-[85vw] z-[70] lg:hidden shadow-2xl"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
