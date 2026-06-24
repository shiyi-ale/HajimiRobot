#include "motor.h"
#include "tim.h" 
#include "gpio.h"
#include "kinematics.h"

Motor_HandleTypeDef motor[4] = {
    // M1 左前
    {
        .htim_pwm = &htim1, .pwm_ch = TIM_CHANNEL_1,
        .in1_port = GPIOE, .in1_pin = GPIO_PIN_11,
        .in2_port = GPIOE, .in2_pin = GPIO_PIN_13,
        .htim_enc = &htim2,      
        .encoder_cnt = 0
    },
    // M2 右前
    {
        .htim_pwm = &htim1, .pwm_ch = TIM_CHANNEL_2,
        .in1_port = GPIOE, .in1_pin = GPIO_PIN_9,
        .in2_port = GPIOE, .in2_pin = GPIO_PIN_14,
        .htim_enc = &htim3,      
        .encoder_cnt = 0
    },
    // M3 左后
    {
        .htim_pwm = &htim1, .pwm_ch = TIM_CHANNEL_3,
        .in1_port = GPIOE, .in1_pin = GPIO_PIN_12,
        .in2_port = GPIOB, .in2_pin = GPIO_PIN_8,
        .htim_enc = &htim4,      
        .encoder_cnt = 0
    },
    // M4 右后
    {
        .htim_pwm = &htim1, .pwm_ch = TIM_CHANNEL_4,
        .in1_port = GPIOB, .in1_pin = GPIO_PIN_1,
        .in2_port = GPIOB, .in2_pin = GPIO_PIN_0,
        .htim_enc = &htim8,      
        .encoder_cnt = 0
    }
};

void Motor_Init(void)
{
    // 启动 TIM1 四路 PWM
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1);
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_2);
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_3);
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_4);
    
    // 启动编码器定时器
    HAL_TIM_Encoder_Start(motor[0].htim_enc, TIM_CHANNEL_ALL);
    HAL_TIM_Encoder_Start(motor[1].htim_enc, TIM_CHANNEL_ALL);
    HAL_TIM_Encoder_Start(motor[2].htim_enc, TIM_CHANNEL_ALL);
    HAL_TIM_Encoder_Start(motor[3].htim_enc, TIM_CHANNEL_ALL);
    
    // 初始停止所有电机
    for (int i = 0; i < 4; i++)
        Motor_SetSpeed(&motor[i], 0);
}

void Motor_SetSpeed(Motor_HandleTypeDef *m, int16_t speed)
{
    uint32_t pwm_val;
    if (speed > 0) {
        HAL_GPIO_WritePin(m->in1_port, m->in1_pin, GPIO_PIN_SET);
        HAL_GPIO_WritePin(m->in2_port, m->in2_pin, GPIO_PIN_RESET);
        pwm_val = (speed > 1000) ? 1000 : speed;
    } else if (speed < 0) {
        HAL_GPIO_WritePin(m->in1_port, m->in1_pin, GPIO_PIN_RESET);
        HAL_GPIO_WritePin(m->in2_port, m->in2_pin, GPIO_PIN_SET);
        pwm_val = (-speed > 1000) ? 1000 : -speed;
    } else {
        HAL_GPIO_WritePin(m->in1_port, m->in1_pin, GPIO_PIN_RESET);
        HAL_GPIO_WritePin(m->in2_port, m->in2_pin, GPIO_PIN_RESET);
        pwm_val = 0;
    }
    __HAL_TIM_SET_COMPARE(m->htim_pwm, m->pwm_ch, pwm_val);
}

// 读取编码器当前脉冲数，清零并更新 current_speed
void Motor_UpdateEncoder(Motor_HandleTypeDef *m)
{
    int32_t cnt = (int32_t)__HAL_TIM_GET_COUNTER(m->htim_enc);
    __HAL_TIM_SET_COUNTER(m->htim_enc, 0);
    m->encoder_cnt += cnt;
    // 将脉冲数转换为速度标度 (-1000~1000)
    m->current_speed = (int16_t)(cnt * 2);
    if (m->current_speed > 1000) m->current_speed = 1000;
    if (m->current_speed < -1000) m->current_speed = -1000;
}

// 每10ms调用一次，执行闭环控制
void Motor_ControlLoop(float vx, float vy, float omega)
{
    if (!motor_enabled) {
        // 如果未使能，强制所有电机停止
        for (int i = 0; i < 4; i++) {
            Motor_SetSpeed(&motor[i], 0);
        }
        return;
    }
		int16_t target_speeds[4];
    Kinematics_Inverse(vx, vy, omega, target_speeds);
    
    for (int i = 0; i < 4; i++) 
		{
        motor[i].target_speed = target_speeds[i];
        Motor_UpdateEncoder(&motor[i]);
        float out = PID_Calculate(&motor[i].pid, motor[i].target_speed, motor[i].current_speed);
        Motor_SetSpeed(&motor[i], (int16_t)out);
    }
}

void Motor_BrakeAll(void)
{
    for (int i = 0; i < 4; i++) {
        // 设置 IN1=IN2=1，进入短制动模式
        HAL_GPIO_WritePin(motor[i].in1_port, motor[i].in1_pin, GPIO_PIN_SET);
        HAL_GPIO_WritePin(motor[i].in2_port, motor[i].in2_pin, GPIO_PIN_SET);
        // 也可将 PWM 设为0，但制动模式下 PWM 信号不影响输出状态
    }
}



