#pragma once
#include <cstdarg>
namespace Eloquent {
    namespace ML {
        namespace Port {
            class PhRegressor {
                public:
                    /**
                    * Predict class for features vector
                    */
                    float predict(float *x) {
                        if (x[3] <= 1813.5) {
                            if (x[1] <= 53.60000038146973) {
                                if (x[1] <= 51.60000038146973) {
                                    return 6.0525f;
                                }

                                else {
                                    return 6.959999999999999f;
                                }
                            }

                            else {
                                if (x[1] <= 56.25) {
                                    if (x[2] <= 57.25) {
                                        return 5.694999999999999f;
                                    }

                                    else {
                                        return 5.4125f;
                                    }
                                }

                                else {
                                    if (x[2] <= 67.95000076293945) {
                                        if (x[2] <= 55.20000076293945) {
                                            if (x[1] <= 58.45000076293945) {
                                                return 6.9375f;
                                            }

                                            else {
                                                return 6.118490566037736f;
                                            }
                                        }

                                        else {
                                            if (x[2] <= 59.55000114440918) {
                                                return 5.454545454545454f;
                                            }

                                            else {
                                                return 5.983846153846154f;
                                            }
                                        }
                                    }

                                    else {
                                        if (x[3] <= 1013.75) {
                                            return 7.124f;
                                        }

                                        else {
                                            if (x[1] <= 86.35000228881836) {
                                                return 6.498888888888889f;
                                            }

                                            else {
                                                return 5.806f;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        else {
                            if (x[3] <= 1873.4500122070312) {
                                return 7.21f;
                            }

                            else {
                                if (x[3] <= 2677.0) {
                                    if (x[2] <= 25.850000381469727) {
                                        return 5.675714285714285f;
                                    }

                                    else {
                                        if (x[3] <= 2553.3499755859375) {
                                            if (x[0] <= 21.90000057220459) {
                                                return 5.9816666666666665f;
                                            }

                                            else {
                                                return 6.4693749999999985f;
                                            }
                                        }

                                        else {
                                            if (x[0] <= 28.199999809265137) {
                                                return 6.455f;
                                            }

                                            else {
                                                return 5.4875f;
                                            }
                                        }
                                    }
                                }

                                else {
                                    if (x[3] <= 2716.5) {
                                        return 7.156000000000001f;
                                    }

                                    else {
                                        if (x[1] <= 55.04999923706055) {
                                            return 7.0275f;
                                        }

                                        else {
                                            if (x[2] <= 34.10000038146973) {
                                                return 6.735f;
                                            }

                                            else {
                                                return 6.031538461538461f;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                protected:
                };
            }
        }
    }