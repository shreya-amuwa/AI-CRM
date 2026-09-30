import React from 'react';

interface AmuwaLogoProps {
  size?: 'sm' | 'md' | 'lg';
  layout?: 'vertical' | 'horizontal';
  className?: string;
}

export const AmuwaLogo: React.FC<AmuwaLogoProps> = ({ 
  size = 'md',
  className = ''
}) => {
  // Height sizing for the logo image
  const heightClass = size === 'sm' 
    ? 'h-10 sm:h-12' 
    : size === 'lg' 
    ? 'h-36 sm:h-44 max-w-[90vw]' 
    : 'h-20 sm:h-24';

  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <img
        src="/amuwa-logo.png"
        alt="Amuwa Corporation - We Help The World To Find You"
        className={`${heightClass} w-auto object-contain transition-all drop-shadow-xs`}
      />
    </div>
  );
};
