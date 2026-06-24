#ifndef __PID_H
#define __PID_H

#include "main.h"

typedef struct {
    float Kp, Ki, Kd;
    float integral_limit;
    float output_limit;
    float last_error;
    float integral;
    float output;
} PID_HandleTypeDef;

void PID_Init(PID_HandleTypeDef *pid, float kp, float ki, float kd, float i_lim, float o_lim);
float PID_Calculate(PID_HandleTypeDef *pid, float target, float current);

#endif


