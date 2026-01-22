
export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export enum BotState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  THINKING = 'THINKING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR'
}

export interface CourseInfo {
  name: string;
  duration: string;
  fees: string;
  topics: string[];
  career: string;
}
