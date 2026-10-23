"use client";

// 相談の画面（ConsultConsole）だけを囲む安全装置：相談の画面で問題が起きても、ページのほか（会社情報・電話ボタンなど）はそのまま使える
import { Component, type ErrorInfo, type ReactNode } from "react";
import ErrorFallback from "../ErrorFallback";

interface State {
  error: unknown;
  key: number;
}

export default class ConsultBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, key: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // 記録は ErrorFallback が行う
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback compact error={this.state.error} where="AI相談の画面" reset={() => this.setState((s) => ({ error: null, key: s.key + 1 }))} />;
    }
    return <div key={this.state.key}>{this.props.children}</div>;
  }
}
