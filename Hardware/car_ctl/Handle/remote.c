#include "remote.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

extern volatile float target_vx, target_vy, target_omega;
extern volatile uint8_t new_cmd_flag;
extern volatile uint8_t motor_enabled;   // 0:禁止运动, 1:允许运动
extern volatile int16_t motor1_speed;
extern volatile int16_t motor2_speed;
void Remote_Parse_Single(uint8_t data)
{
    switch (data)
    {
//        case 'F':
//            target_vx = 0.5; target_vy = 0; target_omega = 0;
//						motor_enabled = 1;   // 使能运动
//            break;
//        case 'B':
//            target_vx = -0.5; target_vy = 0; target_omega = 0;
//						motor_enabled = 1;   // 使能运动
//            break;
//        case 'L':
//            target_vx = 0; target_vy = -0.5; target_omega = 0;
//						motor_enabled = 1;   // 使能运动
//            break;
//        case 'R':
//            target_vx = 0; target_vy = 0.5; target_omega = 0;
//						motor_enabled = 1;   // 使能运动
//            break;
//        case 'Q':
//            target_vx = 0; target_vy = 0; target_omega = 1.0;
//						motor_enabled = 1;   // 使能运动
//            break;
//        case 'E':
//            target_vx = 0; target_vy = 0; target_omega = -1.0;
//						motor_enabled = 1;   // 使能运动
//            break;
//        case 'S':
//            target_vx = 0; target_vy = 0; target_omega = 0;
//						Motor_BrakeAll();
//						motor_enabled = 1;   // 使能运动
//            break;
//        default:
//            // 忽略其他字符（如空格、换行符等）
//            return;
			  case 'F':   // 前进
            motor1_speed = 500;
            motor2_speed = 500;
            break;
        case 'B':   // 后退
            motor1_speed = -500;
            motor2_speed = -500;
            break;
        case 'L':   // 左旋
            motor1_speed = -500;
            motor2_speed = 500;
            break;
        case 'R':   // 右旋
            motor1_speed = 500;
            motor2_speed = -500;
            break;
        case 'S':   // 停止
            motor1_speed = 0;
            motor2_speed = 0;
            break;
				case 'G':
						HAL_GPIO_WritePin(GPIOE, GPIO_PIN_7, GPIO_PIN_SET); //喂食电机控制
						HAL_Delay(647);
						HAL_GPIO_WritePin(GPIOE, GPIO_PIN_7, GPIO_PIN_RESET); //喂食电机控制
        default:
            // 其他字符忽略
            return;
    }
    new_cmd_flag = 1;
}

