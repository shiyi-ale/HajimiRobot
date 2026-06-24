#include "pid.h"

void PID_Init(PID_HandleTypeDef *pid, float kp, float ki, float kd, float i_lim, float o_lim)
{
    pid->Kp = kp;
    pid->Ki = ki;
    pid->Kd = kd;
    pid->integral_limit = i_lim;
    pid->output_limit = o_lim;
    pid->last_error = 0;
    pid->integral = 0;
}

float PID_Calculate(PID_HandleTypeDef *pid, float target, float current)
{
    float error = target - current;
    pid->integral += error;
    if (pid->integral > pid->integral_limit) pid->integral = pid->integral_limit;
    if (pid->integral < -pid->integral_limit) pid->integral = -pid->integral_limit;
    float derivative = error - pid->last_error;
    pid->output = pid->Kp * error + pid->Ki * pid->integral + pid->Kd * derivative;
    pid->last_error = error;
    if (pid->output > pid->output_limit) pid->output = pid->output_limit;
    if (pid->output < -pid->output_limit) pid->output = -pid->output_limit;
    return pid->output;
}


