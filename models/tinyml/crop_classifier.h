#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class CropClassifier {
                public:
                    /**
                    * Predict class for features vector
                    */
                    int predict(float *x) {
                        if (x[1] <= 63.35000038146973) {
                            if (x[0] <= 29.699999809265137) {
                                if (x[1] <= 53.10000038146973) {
                                    if (x[0] <= 24.75) {
                                        return 0;
                                    }

                                    else {
                                        return 8;
                                    }
                                }

                                else {
                                    if (x[1] <= 62.10000038146973) {
                                        if (x[3] <= 1261.8499755859375) {
                                            if (x[2] <= 39.19999885559082) {
                                                return 2;
                                            }

                                            else {
                                                if (x[4] <= 6.051168441772461) {
                                                    return 13;
                                                }

                                                else {
                                                    return 14;
                                                }
                                            }
                                        }

                                        else {
                                            if (x[4] <= 5.685357332229614) {
                                                return 6;
                                            }

                                            else {
                                                if (x[0] <= 21.449999809265137) {
                                                    return 0;
                                                }

                                                else {
                                                    return 12;
                                                }
                                            }
                                        }
                                    }

                                    else {
                                        return 9;
                                    }
                                }
                            }

                            else {
                                if (x[1] <= 58.25) {
                                    if (x[2] <= 48.5) {
                                        return 0;
                                    }

                                    else {
                                        return 17;
                                    }
                                }

                                else {
                                    return 6;
                                }
                            }
                        }

                        else {
                            if (x[1] <= 92.4000015258789) {
                                if (x[3] <= 2758.8499755859375) {
                                    if (x[3] <= 1147.0999755859375) {
                                        if (x[1] <= 69.20000076293945) {
                                            return 3;
                                        }

                                        else {
                                            if (x[3] <= 682.3999938964844) {
                                                return 8;
                                            }

                                            else {
                                                if (x[3] <= 855.8000183105469) {
                                                    return 19;
                                                }

                                                else {
                                                    return 4;
                                                }
                                            }
                                        }
                                    }

                                    else {
                                        if (x[1] <= 89.14999771118164) {
                                            if (x[1] <= 82.04999923706055) {
                                                if (x[3] <= 2463.2000732421875) {
                                                    return 12;
                                                }

                                                else {
                                                    return 10;
                                                }
                                            }

                                            else {
                                                if (x[1] <= 84.5) {
                                                    return 14;
                                                }

                                                else {
                                                    return 5;
                                                }
                                            }
                                        }

                                        else {
                                            if (x[3] <= 1973.0999755859375) {
                                                return 3;
                                            }

                                            else {
                                                return 16;
                                            }
                                        }
                                    }
                                }

                                else {
                                    if (x[1] <= 73.25) {
                                        return 3;
                                    }

                                    else {
                                        return 11;
                                    }
                                }
                            }

                            else {
                                if (x[2] <= 51.0) {
                                    if (x[2] <= 31.40000057220459) {
                                        return 13;
                                    }

                                    else {
                                        return 8;
                                    }
                                }

                                else {
                                    return 17;
                                }
                            }
                        }
                    }

                protected:
                };
            }
        }
    }