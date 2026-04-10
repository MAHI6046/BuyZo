'use client';

import React, { useEffect, useState } from 'react';
import { 
  ShoppingBag, 
  TrendingUp, 
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ChevronRight,
  Plus
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalProducts: 0,
    activeProducts: 0,
    totalCategories: 0,
    lowStock: 0
  });

  useEffect(() => {
    fetch('/api/dashboard-stats')
      .then(res => res.json())
      .then(data => {
        setStats({
          totalProducts: Number(data?.totalProducts || 0),
          activeProducts: Number(data?.activeProducts || 0),
          totalCategories: Number(data?.totalCategories || 0),
          lowStock: Number(data?.lowStock || 0)
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { name: 'Total Products', value: stats.totalProducts, icon: Package, color: 'text-blue-500', bg: 'bg-blue-50', trend: '+12%' },
    { name: 'Active Items', value: stats.activeProducts, icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-50', trend: '+5%' },
    { name: 'Categories', value: stats.totalCategories, icon: ShoppingBag, color: 'text-primary', bg: 'bg-primary/10', trend: '0%' },
    { name: 'Low Stock', value: stats.lowStock, icon: Clock, color: 'text-red-500', bg: 'bg-red-50', trend: '-2%' },
  ];

  return (
    <div className="space-y-6 md:space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">Overview</h1>
          <p className="text-foreground/50 mt-1 font-medium text-base md:text-lg">Welcome back, here&apos;s what&apos;s happening today.</p>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <div className="px-3 md:px-4 py-2 bg-white border border-border rounded-xl text-xs md:text-sm font-bold text-foreground/60 shadow-sm">
            Last 30 Days
          </div>
          <button className="flex-1 md:flex-none px-4 md:px-6 py-2.5 bg-primary text-white rounded-xl text-xs md:text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all whitespace-nowrap">
            Download Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white border border-border p-6 md:p-8 rounded-2xl md:rounded-lg shadow-sm hover:shadow-xl transition-all duration-300 group"
          >
            <div className="flex items-start justify-between">
              <div className={cn("p-3 md:p-4 rounded-xl md:rounded-2xl", stat.bg)}>
                <stat.icon className={cn("w-6 h-6 md:w-7 md:h-7", stat.color)} />
              </div>
              <div className={cn(
                "flex items-center gap-1 text-xs md:text-sm font-bold px-2 py-1 md:px-2.5 md:py-1 rounded-lg",
                stat.trend.startsWith('+') ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"
              )}>
                {stat.trend.startsWith('+') ? <ArrowUpRight className="w-3 h-3 md:w-3.5 md:h-3.5" /> : <ArrowDownRight className="w-3 h-3 md:w-3.5 md:h-3.5" />}
                {stat.trend}
              </div>
            </div>
            <div className="mt-4 md:mt-6">
              <p className="text-foreground/40 font-bold text-[10px] md:text-sm uppercase tracking-widest">{stat.name}</p>
              {loading ? (
                <div className="h-10 md:h-12 w-20 md:w-24 mt-2 rounded-lg shimmer" />
              ) : (
                <h3 className="text-2xl md:text-4xl font-black text-foreground mt-1 md:mt-2 group-hover:text-primary transition-colors">{stat.value}</h3>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        <div className="lg:col-span-2 bg-white border border-border rounded-2xl md:rounded-lg p-6 md:p-10 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-6 md:mb-10">
            <h3 className="text-xl md:text-2xl font-black">Inventory Activity</h3>
            <button className="text-primary font-bold text-sm hover:underline flex items-center gap-1">
              View All <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="h-48 md:h-64 flex items-end justify-between gap-2 md:gap-4">
            {[40, 70, 45, 90, 65, 80, 50, 85, 60, 75, 55, 95].map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ delay: i * 0.05, duration: 0.8, ease: "easeOut" }}
                className="flex-1 bg-surface hover:bg-primary/20 rounded-t-lg md:rounded-t-xl transition-all cursor-pointer relative group min-w-[12px]"
              >
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-foreground text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  {h}%
                </div>
              </motion.div>
            ))}
          </div>
          <div className="flex justify-between mt-6 text-[8px] md:text-xs font-bold text-foreground/30 uppercase tracking-widest px-2 overflow-x-auto">
            <span>Jan</span>
            <span className="hidden sm:inline">Feb</span>
            <span>Mar</span>
            <span className="hidden sm:inline">Apr</span>
            <span>May</span>
            <span className="hidden sm:inline">Jun</span>
            <span>Jul</span>
            <span className="hidden sm:inline">Aug</span>
            <span>Sep</span>
            <span className="hidden sm:inline">Oct</span>
            <span>Nov</span>
            <span>Dec</span>
          </div>
        </div>

        <div className="bg-primary text-white rounded-2xl md:rounded-lg p-8 md:p-10 shadow-xl shadow-primary/20 relative overflow-hidden group">
          <div className="relative z-10">
            <h3 className="text-xl md:text-2xl font-black mb-2">New Product Launch</h3>
            <p className="text-white/80 font-medium mb-6 md:mb-8 text-sm md:text-base">Quickly add a new product to your store and reach more customers.</p>
            <Link 
              href="/products/new"
              className="inline-flex items-center gap-2 bg-white text-primary px-6 md:px-8 py-3 md:py-4 rounded-xl md:rounded-2xl font-black text-base md:text-lg hover:scale-105 active:scale-95 transition-all shadow-lg shadow-black/10"
            >
              Get Started <Plus className="w-5 h-5 md:w-6 md:h-6" />
            </Link>
          </div>
          <Package className="absolute -bottom-6 -right-6 md:-bottom-10 md:-right-10 w-48 h-48 md:w-64 md:h-64 text-white/10 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
        </div>
      </div>
    </div>
  );
}
