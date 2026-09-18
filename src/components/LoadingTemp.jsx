function LoadingScreen() {
  return (
    <div className="loading-container">
      <div className="spinner"></div>

      <h3>Processing your T-REX report...</h3>

      <p>
        Running reconciliation and preparing the report...
      </p>
    </div>
  );
}

export default LoadingScreen;