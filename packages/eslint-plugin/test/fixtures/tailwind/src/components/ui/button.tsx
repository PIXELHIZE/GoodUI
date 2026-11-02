type ButtonProps = {
  size?: 'sm' | 'lg';
  variant?: 'default' | 'destructive';
  className?: string;
};

export function Button({ className }: ButtonProps) {
  return <button className={className}>Button</button>;
}
