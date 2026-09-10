interface SectionLabelProps {
  text: string;
  className?: string;
}

export default function SectionLabel({ text, className = '' }: SectionLabelProps) {
  return (
    <p className={`font-data text-[12px] text-crt mb-12 ${className}`}>{text}</p>
  );
}
