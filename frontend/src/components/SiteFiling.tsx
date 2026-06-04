interface SiteFilingProps {
  className?: string;
  linkClassName?: string;
}

export function SiteFiling({ className, linkClassName }: SiteFilingProps) {
  return (
    <p className={className}>
      © 2026 ArborLearn ·{" "}
      <a className={linkClassName} href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
        粤ICP备2026069664号-1
      </a>
    </p>
  );
}
