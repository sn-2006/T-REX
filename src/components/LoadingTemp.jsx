function LoadingScreen() {
  return (
    <div className="loading-container" style={{ textAlign: 'center', padding: '40px' }}>
      <style>{`
        @keyframes run {
          0% { transform: translateX(-50px) scaleX(1); }
          49% { transform: translateX(50px) scaleX(1); }
          50% { transform: translateX(50px) scaleX(-1); }
          99% { transform: translateX(-50px) scaleX(-1); }
          100% { transform: translateX(-50px) scaleX(1); }
        }
        .dino-running {
          font-size: 48px;
          animation: run 2s linear infinite;
          display: inline-block;
        }
      `}</style>
      <div style={{ height: '80px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <span className="dino-running">🦖</span>
      </div>

      <h3>Loading T-REX Analytics...</h3>
      <p style={{ color: '#888' }}>
        Fetching transaction data and preparing the dashboard...
      </p>
    </div>
  );
}

export default LoadingScreen;