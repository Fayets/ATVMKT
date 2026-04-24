import React from 'react'

type BGVariantType = 'dots' | 'diagonal-stripes' | 'grid' | 'horizontal-lines' | 'vertical-lines' | 'checkerboard'
type BGMaskType =
  | 'fade-center'
  | 'fade-edges'
  | 'fade-top'
  | 'fade-bottom'
  | 'fade-left'
  | 'fade-right'
  | 'fade-x'
  | 'fade-y'
  | 'none'

type BGPatternProps = React.ComponentProps<'div'> & {
  variant?: BGVariantType
  mask?: BGMaskType
  size?: number
  fill?: string
}

const maskStyles: Record<BGMaskType, string> = {
  'fade-edges': 'radial-gradient(ellipse at center, black, transparent)',
  'fade-center': 'radial-gradient(ellipse at center, transparent, black)',
  'fade-top': 'linear-gradient(to bottom, transparent, black)',
  'fade-bottom': 'linear-gradient(to bottom, black, transparent)',
  'fade-left': 'linear-gradient(to right, transparent, black)',
  'fade-right': 'linear-gradient(to right, black, transparent)',
  'fade-x': 'linear-gradient(to right, transparent, black, transparent)',
  'fade-y': 'linear-gradient(to bottom, transparent, black, transparent)',
  none: '',
}

function getBgImage(variant: BGVariantType, fill: string, size: number) {
  switch (variant) {
    case 'dots':
      return `radial-gradient(${fill} 1px, transparent 1px)`
    case 'grid':
      return `linear-gradient(to right, ${fill} 1px, transparent 1px), linear-gradient(to bottom, ${fill} 1px, transparent 1px)`
    case 'diagonal-stripes':
      return `repeating-linear-gradient(45deg, ${fill}, ${fill} 1px, transparent 1px, transparent ${size}px)`
    case 'horizontal-lines':
      return `linear-gradient(to bottom, ${fill} 1px, transparent 1px)`
    case 'vertical-lines':
      return `linear-gradient(to right, ${fill} 1px, transparent 1px)`
    case 'checkerboard':
      return `linear-gradient(45deg, ${fill} 25%, transparent 25%), linear-gradient(-45deg, ${fill} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${fill} 75%), linear-gradient(-45deg, transparent 75%, ${fill} 75%)`
    default:
      return undefined
  }
}

const BGPattern = ({
  variant = 'grid',
  mask = 'none',
  size = 24,
  fill = '#252525',
  className = '',
  style,
  ...props
}: BGPatternProps) => {
  const bgSize = `${size}px ${size}px`
  const backgroundImage = getBgImage(variant, fill, size)
  const maskImage = maskStyles[mask]

  return (
    <div
      className={`absolute inset-0 w-full h-full ${className}`}
      style={{
        backgroundImage,
        backgroundSize: bgSize,
        ...(maskImage ? { maskImage, WebkitMaskImage: maskImage } : {}),
        ...style,
      }}
      {...props}
    />
  )
}

BGPattern.displayName = 'BGPattern'
export { BGPattern }
