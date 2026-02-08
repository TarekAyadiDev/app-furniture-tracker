interface PageHeaderProps {
  subtitle?: string;
  title: string;
}

export function PageHeader({ subtitle, title }: PageHeaderProps) {
  return (
    <header className="px-4 pt-6 pb-2">
      {subtitle && (
        <p className="text-xs font-medium uppercase tracking-wider text-primary">{subtitle}</p>
      )}
      <h1 className="font-heading text-2xl font-normal text-foreground">{title}</h1>
    </header>
  );
}
