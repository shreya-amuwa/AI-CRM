import React from 'react';
import { Building2, Cpu, DollarSign, GraduationCap, Layers, MessageSquare, PhoneCall, ShoppingBag, Sparkles, Star, Users } from 'lucide-react';

const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Building2, Sparkles, Star, ShoppingBag, MessageSquare, PhoneCall, Cpu, Layers, GraduationCap, Users, DollarSign
};

/** The icon the department record names (the same names the Super Admin hub uses). */
export const DepartmentIcon: React.FC<{ name: string | null | undefined; className?: string; color?: string | null }> = ({ name, className = 'w-5 h-5', color }) => {
  const Icon = (name && ICONS[name]) || Building2;
  return <Icon className={className} style={color ? { color } : undefined} aria-hidden="true" />;
};
