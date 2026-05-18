interface AmbientBackdropProps {
  variant?: "dashboard" | "workspace";
}

const dashboardParticles = [
  { left: "10%", top: "22%", delay: "0s", size: "7px" },
  { left: "21%", top: "66%", delay: "-4s", size: "4px" },
  { left: "34%", top: "18%", delay: "-7s", size: "5px" },
  { left: "49%", top: "74%", delay: "-12s", size: "5px" },
  { left: "63%", top: "34%", delay: "-2s", size: "6px" },
  { left: "78%", top: "60%", delay: "-9s", size: "4px" },
  { left: "89%", top: "24%", delay: "-5s", size: "5px" },
];

const workspaceParticles = [
  { left: "5%", top: "34%", delay: "-2s", size: "4px" },
  { left: "24%", top: "10%", delay: "-6s", size: "5px" },
  { left: "38%", top: "28%", delay: "-14s", size: "4px" },
  { left: "49%", top: "76%", delay: "-10s", size: "4px" },
  { left: "69%", top: "18%", delay: "-3s", size: "6px" },
  { left: "86%", top: "54%", delay: "-8s", size: "4px" },
];

export function AmbientBackdrop({ variant = "dashboard" }: AmbientBackdropProps) {
  const particles = variant === "dashboard" ? dashboardParticles : workspaceParticles;

  return (
    <div className={`ambient-backdrop ambient-backdrop--${variant}`} aria-hidden="true">
      <div className="ambient-grid" />
      <div className="ambient-aurora ambient-aurora-a" />
      <div className="ambient-aurora ambient-aurora-b" />
      <div className="ambient-aurora ambient-aurora-c" />
      <svg className="ambient-network" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M10 22 C22 28, 24 54, 21 66" />
        <path d="M34 18 C42 32, 50 28, 63 34" />
        <path d="M63 34 C70 45, 75 50, 78 60" />
        <path d="M49 74 C58 65, 68 64, 78 60" />
        <path d="M63 34 C72 26, 80 20, 89 24" />
      </svg>
      <div className="ambient-thread ambient-thread-a" />
      <div className="ambient-thread ambient-thread-b" />
      <div className="ambient-thread ambient-thread-c" />
      {particles.map((particle, index) => (
        <span
          key={index}
          className="ambient-particle"
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            animationDelay: particle.delay,
          }}
        />
      ))}
    </div>
  );
}
