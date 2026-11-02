interface CompactProps { size?: 'compact'; className?: string }
interface GiantProps { size?: 'huge'; className?: string }
export function CompactButton({className}: CompactProps) { return <button className={className}/>; }
export function GiantAlert({className}: GiantProps) { return <aside className={className}/>; }
