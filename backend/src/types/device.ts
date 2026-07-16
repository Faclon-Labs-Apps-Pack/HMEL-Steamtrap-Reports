export interface DeviceSensor {
  sensorId: string;
  sensorName: string;
}

export interface Device {
  devID: string;
  devName: string;
  devTypeID: string;
  devTypeName: string;
  sensors: DeviceSensor[];
  tags: string[];
}

export interface LastDataPoint {
  devID: string;
  sensor: string;
  time: string;
  value: number | string;
  unit?: string;
}
