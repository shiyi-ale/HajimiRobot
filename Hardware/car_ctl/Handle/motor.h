#ifndef __MOTOR_H
#define __MOTOR_H

#include "main.h"
#include "pid.h"

typedef enum {
    MOTOR_FL = 0,  // 左前
    MOTOR_FR = 1,  // 右前
    MOTOR_RL = 2,  // 左后
    MOTOR_RR = 3   // 右后
} Motor_ID;

typedef struct {
    // PWM 定时器及通道
    TIM_HandleTypeDef *htim_pwm;
    uint32_t pwm_ch;
    // 方向引脚
    GPIO_TypeDef *in1_port;
    uint16_t in1_pin;
    GPIO_TypeDef *in2_port;
    uint16_t in2_pin;
    // 编码器定时器
    TIM_HandleTypeDef *htim_enc;
    // 状态变量
    volatile int32_t encoder_cnt;   // 累计脉冲数
    int16_t target_speed;           // 目标速度 (-1000 ~ 1000)
    int16_t current_speed;          // 实际速度
    PID_HandleTypeDef pid;
} Motor_HandleTypeDef;

extern Motor_HandleTypeDef motor[4];
extern volatile uint8_t motor_enabled;   // 0:禁止运动, 1:允许运动
void Motor_Init(void);
void Motor_SetSpeed(Motor_HandleTypeDef *m, int16_t speed);
void Motor_UpdateEncoder(Motor_HandleTypeDef *m);
void Motor_ControlLoop(float vx, float vy, float omega);
void Motor_BrakeAll(void);
#endif


