export interface RobotColor {
  mesh: number;
  css: string;
}
export const ROBOT_PALETTE: readonly RobotColor[];
export function robotColor(index: number): RobotColor;
