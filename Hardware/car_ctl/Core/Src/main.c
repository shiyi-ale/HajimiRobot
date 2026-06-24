/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2026 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "tim.h"
#include "usart.h"
#include "gpio.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "oled.h"
#include "motor.h"
#include "kinematics.h"
#include "remote.h"
#include <string.h>
#include <stdio.h>
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */
/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/

/* USER CODE BEGIN PV */
// 遥控变量
volatile float target_vx = 0, target_vy = 0, target_omega = 0;
volatile uint8_t new_cmd_flag = 0;
volatile uint8_t motor_enabled = 0;   // 0:禁止运动, 1:允许运动
// 串口接收缓冲区
uint8_t uart_rx_line[64];
uint8_t uart_rx_index = 0;
volatile int16_t motor1_speed = 0;
volatile int16_t motor2_speed = 0;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */

/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{

  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_USART2_UART_Init();
  MX_TIM1_Init();
  MX_TIM2_Init();
  MX_TIM3_Init();
  MX_TIM4_Init();
  MX_TIM8_Init();
  MX_TIM6_Init();
  /* USER CODE BEGIN 2 */
	OLED_Init();
	OLED_Clear();
	OLED_ColorTurn(0);//0正常显示，1 反色显示
  OLED_DisplayTurn(0);//0正常显示 1 屏幕翻转显示
	OLED_ShowString(0, 0, (uint8_t*)"Hajimi Robot", 16);
	OLED_Refresh();
	Motor_Init();
  Kinematics_Init(0.03f, 0.15f);   // 轮半径0.03m, 机器人半径0.15m
  for (int i = 0; i < 4; i++) 
	{
		PID_Init(&motor[i].pid, 2.0f, 0.1f, 0.4f, 500.0f, 1000.0f);
  }
	
	HAL_TIM_Base_Start_IT(&htim6);
	
	
	uint32_t last_display = 0;
  char line_buf[32];
	char display_line[32];
//	Motor_SetSpeed(&motor[0], 500);  // 左前电机以50%占空比正转
//	Motor_SetSpeed(&motor[1], 500);
//	Motor_SetSpeed(&motor[2], 500);
//	Motor_SetSpeed(&motor[3], 500);
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
        // 1. 轮询接收蓝牙数据
        if (__HAL_UART_GET_FLAG(&huart2, UART_FLAG_RXNE) != RESET)
        {
          uint8_t data = (uint8_t)(huart2.Instance->DR & 0xFF);
        // 立即回传
					HAL_UART_Transmit(&huart2, &data, 1, 100);
					sprintf(display_line, "RX: 0x%02X '%c'", data, (data >= 32 && data <= 126) ? data : '.');
          OLED_ShowString(0, 20, (uint8_t*)display_line, 12);
					OLED_Refresh();
					Remote_Parse_Single(data);
					Motor_SetSpeed(&motor[0], motor1_speed);   // 左前
					Motor_SetSpeed(&motor[1], motor2_speed);   // 右前
        }

        // 2. 处理新命令，刷新 OLED 显示
        if (new_cmd_flag)
        {
            new_cmd_flag = 0;
            sprintf(line_buf, "VX:%.2f VY:%.2f", target_vx, target_vy);
            OLED_ShowString(0, 30, (uint8_t*)line_buf, 12);
            sprintf(line_buf, "OMG:%.2f", target_omega);
            OLED_ShowString(0, 40, (uint8_t*)line_buf, 12);
						OLED_Refresh();
        }

        // 3. 心跳显示（每500ms）
        if (HAL_GetTick() - last_display > 500)
        {
            last_display = HAL_GetTick();
            static uint32_t beat = 0;
            sprintf(line_buf, "Heart:%04d", beat++);
            OLED_ShowString(0, 50, (uint8_t*)line_buf, 12);
						OLED_Refresh();
        }

        // 4. 其他非阻塞任务
        HAL_Delay(10);
				
	}
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Configure the main internal regulator output voltage
  */
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE1);

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLM = 4;
  RCC_OscInitStruct.PLL.PLLN = 168;
  RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV2;
  RCC_OscInitStruct.PLL.PLLQ = 4;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV4;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV2;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_5) != HAL_OK)
  {
    Error_Handler();
  }
}

/* USER CODE BEGIN 4 */
// 10ms 控制周期中断（用于电机闭环）
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
    if (htim->Instance == TIM6) {
        Motor_ControlLoop(target_vx, target_vy, target_omega);
    }
}
/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}
#ifdef USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
