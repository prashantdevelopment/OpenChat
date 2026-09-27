import { Component } from "react";

// Catches WebGL/driver errors in a 3D canvas. The 3D is always extra, so on an
// error it simply disappears and the rest of the page keeps working.
class CanvasBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default CanvasBoundary;
