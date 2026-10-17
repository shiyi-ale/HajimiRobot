import { useLanguage } from './i18n';
const names: Record<string, string> = {eating:'Eating', playing:'Playing', rest:'Resting', sitting:'Sitting', stretching:'Stretching', yawning:'Yawning'};
const chinese: Record<string, string> = {eating:'进食', playing:'玩耍', rest:'休息', sitting:'坐姿', stretching:'伸展', yawning:'打哈欠'};
export function useCopy() {
  const {language} = useLanguage();
  return {language, t:(zh:string,en:string)=>language === 'zh' ? zh : en,
    behavior:(key:string)=> (language === 'zh' ? chinese[key] : names[key]) || key};
}
