import { cva as variants } from 'class-variance-authority';

const panelVariants = variants('flex', {
  variants: {
    size: { sm: 'p-2', lg: 'p-6' },
    tone: { standard: 'bg-brand', quiet: 'bg-accent' },
  },
});

export function Panel({className}: {className?: string}) {
  return <section className={panelVariants({className})}/>;
}
